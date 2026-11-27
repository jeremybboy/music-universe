import AppKit
import WebKit

@MainActor
final class TrackAnalysis {
    private let fileManager = FileManager.default
    private let defaultsKey = "AudioAnalystWorkspace"
    private let playback = TrackPlayback()
    private var process: Process?
    private var output: URL?
    private var source: URL?
    private var cancelled = false

    func handle(_ action: String, message: [String: Any], window: NSWindow) async throws -> Any {
        switch action {
        case "status":
            return status()
        case "configure":
            guard process?.isRunning != true else { throw fail("Wait for the current analysis to finish.") }
            let panel = NSOpenPanel()
            panel.title = "Choose the Audio Analyst workspace"
            panel.message = "Choose the folder that contains the work/audio-analyst and outputs/audio-analyst directories."
            panel.canChooseFiles = false
            panel.canChooseDirectories = true
            guard await panel.beginSheetModal(for: window) == .OK, let url = panel.url else { return status() }
            guard installation(url) else { throw fail("That folder does not contain the prepared Audio Analyst installation.") }
            UserDefaults.standard.set(url.path, forKey: defaultsKey)
            return status()
        case "start":
            return try await start(window)
        case "cancel":
            if process?.isRunning == true {
                cancelled = true
                process?.terminate()
            }
            return status()
        case "play":
            publishAudio()
            try playback.play()
            return status()
        case "auditionOriginal":
            publishAudio()
            playback.selectOriginal()
            try playback.play(from: message["seconds"] as? Double)
            return status()
        case "selectOriginal":
            playback.selectOriginal()
            return status()
        case "selectStems":
            playback.selectStems()
            return status()
        case "toggleStem":
            publishAudio()
            if let name = message["stem"] as? String { playback.toggleStem(name) }
            return status()
        case "pause":
            pausePlayback()
            return status()
        case "seek":
            if let seconds = message["seconds"] as? Double, seconds.isFinite {
                try playback.seek(to: seconds)
            }
            return status()
        case "volume":
            if let level = message["level"] as? Double, level.isFinite {
                playback.setVolume(Float(min(1, max(0, level))))
            }
            return status()
        case "report":
            guard process?.isRunning != true, !cancelled, let output else { throw fail("The report is being prepared.") }
            let report = output.appendingPathComponent("report.json")
            let size = try report.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size > 0, size <= 2 * 1024 * 1024 else { throw fail("The report is missing or larger than 2 MiB.") }
            return try String(contentsOf: report, encoding: .utf8)
        default:
            throw fail("This analysis action is unavailable.")
        }
    }

    func pausePlayback() { playback.pause() }

    func cleanUp() {
        playback.reset()
        if let process, process.isRunning {
            let directory = output
            process.terminationHandler = { _ in
                if let directory { try? FileManager.default.removeItem(at: directory) }
            }
            process.terminate()
        } else if let output {
            try? fileManager.removeItem(at: output)
        }
    }

    private var workspace: URL? {
        guard let path = UserDefaults.standard.string(forKey: defaultsKey) else { return nil }
        let url = URL(fileURLWithPath: path, isDirectory: true)
        return installation(url) ? url : nil
    }

    private func installation(_ url: URL) -> Bool {
        fileManager.isExecutableFile(atPath: url.appendingPathComponent("work/audio-analyst/runtime/bin/python").path) &&
        fileManager.isReadableFile(atPath: url.appendingPathComponent("outputs/audio-analyst/audio_analyst.py").path)
    }

    private func start(_ window: NSWindow) async throws -> [String: Any] {
        guard process?.isRunning != true, let workspace else { throw fail("Connect Audio Analyst before starting a track.") }
        let panel = NSOpenPanel()
        panel.title = "Analyze an audio track"
        panel.allowedContentTypes = [.audio]
        guard await panel.beginSheetModal(for: window) == .OK, let choice = panel.url else { return status() }
        let size = try choice.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size > 0, size <= 512 * 1024 * 1024 else { throw fail("Choose an audio file up to 512 MiB.") }
        guard let helper = Bundle.main.url(forResource: "analyze-track", withExtension: "py") else {
            throw fail("The local analysis helper is missing from this build.")
        }
        let runtime = workspace.appendingPathComponent("work/audio-analyst")
        let output = fileManager.temporaryDirectory.appendingPathComponent("music-universe-" + UUID().uuidString, isDirectory: true)
        try fileManager.createDirectory(at: output, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let process = Process()
        process.executableURL = runtime.appendingPathComponent("runtime/bin/python")
        process.arguments = [helper.path, workspace.path, choice.path, output.path]
        process.environment = [
            "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
            "PYTHONPATH": runtime.appendingPathComponent("deps").path,
            "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1",
            "PYTHONDONTWRITEBYTECODE": "1", "NUMBA_CACHE_DIR": output.path,
        ]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch {
            try? fileManager.removeItem(at: output)
            throw error
        }
        cleanUp()
        self.output = output
        self.process = process
        source = choice
        cancelled = false
        return status()
    }

    private func publishAudio() {
        if let output { playback.publish(from: output) }
    }

    private func status() -> [String: Any] {
        publishAudio()
        var data: [String: Any] = [
            "connected": workspace != nil, "running": process?.isRunning == true, "available": playback.available,
            "percent": 0, "stage": "Preparing audio", "usesOriginal": playback.usesOriginal,
            "selected": TrackPlayback.stemNames.filter { playback.selected.contains($0) },
            "playing": playback.isPlaying, "position": playback.position, "duration": playback.duration,
        ]
        guard let output, let source, let process else { return data }
        data["id"] = output.lastPathComponent
        data["source"] = source.lastPathComponent
        if let buffer = try? Data(contentsOf: output.appendingPathComponent("progress.json")),
           let step = try? JSONSerialization.jsonObject(with: buffer) as? [String: Any] {
            for key in ["percent", "stage", "error"] { data[key] = step[key] }
        }
        if cancelled {
            data["stage"] = process.isRunning ? "Cancelling" : "Cancelled"
        } else if !process.isRunning {
            if process.terminationStatus == 0 {
                data["reportReady"] = true
            } else if data["error"] == nil {
                data["error"] = "Audio Analyst exited before completing the report."
            }
        }
        return data
    }

    private func fail(_ message: String) -> NSError {
        NSError(domain: "MusicUniverse.TrackAnalysis", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
