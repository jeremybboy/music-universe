import AppKit
import AVFoundation
import WebKit

@MainActor
final class TrackAnalysis {
    private let fileManager = FileManager.default
    private let defaultsKey = "AudioAnalystWorkspace"
    private let sources = ["mix", "drums", "bass", "other", "vocals"]
    private var process: Process?
    private var output: URL?
    private var source: URL?
    private var audio: AVAudioPlayer?
    private var channel = "mix"
    private var cancelled = false
    private var volume: Float = 0.8

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
            guard let requested = message["channel"] as? String, sources.contains(requested) else {
                throw fail("Choose the original or an available stem.")
            }
            try play(requested)
            return status()
        case "pause":
            pausePlayback()
            return status()
        case "seek":
            if let audio, let seconds = message["seconds"] as? Double, seconds.isFinite {
                audio.currentTime = min(audio.duration, max(0, seconds))
            }
            return status()
        case "volume":
            if let level = message["level"] as? Double, level.isFinite {
                volume = Float(min(1, max(0, level)))
                audio?.volume = volume
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

    func pausePlayback() { audio?.pause() }

    func cleanUp() {
        audio?.stop()
        audio = nil
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
        channel = "mix"
        cancelled = false
        return status()
    }

    private func status() -> [String: Any] {
        var data: [String: Any] = [
            "connected": workspace != nil, "running": process?.isRunning == true, "available": [],
            "percent": 0, "stage": "Preparing audio", "channel": channel, "playing": audio?.isPlaying ?? false,
            "position": audio?.currentTime ?? 0, "duration": audio?.duration ?? 0,
        ]
        guard let output, let source, let process else { return data }
        data["id"] = output.lastPathComponent
        data["source"] = source.lastPathComponent
        if let buffer = try? Data(contentsOf: output.appendingPathComponent("progress.json")),
           let step = try? JSONSerialization.jsonObject(with: buffer) as? [String: Any] {
            for key in ["percent", "stage", "error"] { data[key] = step[key] }
        }
        data["available"] = sources.filter { fileManager.fileExists(atPath: output.appendingPathComponent($0 + ".wav").path) }
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

    private func play(_ requested: String) throws {
        guard let output else { throw fail("Choose an audio track first.") }
        let chosen = output.appendingPathComponent(requested + ".wav")
        guard fileManager.fileExists(atPath: chosen.path) else { throw fail("That audio is still being prepared.") }
        if let audio, requested == channel {
            if audio.currentTime >= audio.duration - 0.01 { audio.currentTime = 0 }
            guard audio.play() else { throw fail("The audio output could not start.") }
            return
        }
        let next = try AVAudioPlayer(contentsOf: chosen)
        let position = audio?.currentTime ?? 0
        next.volume = volume
        next.currentTime = position >= next.duration - 0.01 ? 0 : position
        audio?.stop()
        audio = next
        channel = requested
        guard next.play() else { throw fail("The audio output could not start.") }
    }

    private func fail(_ message: String) -> NSError {
        NSError(domain: "MusicUniverse.TrackAnalysis", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
