import AVFoundation

@MainActor
final class TrackPlayback {
    static let stemNames = ["drums", "bass", "other", "vocals"]
    static let drumParts = ["kick", "snare", "hihat", "cymbals", "percussion"]
    static let selectableNames = stemNames + drumParts
    private let names = ["mix"] + TrackPlayback.selectableNames
    private let engine: AVAudioEngine
    private var players: [String: AVAudioPlayerNode] = [:]
    private var files: [String: AVAudioFile] = [:]
    private var scheduled = Set<String>()
    private var playhead = 0.0
    private var startTime: UInt64?
    private(set) var usesOriginal = true
    private(set) var selected = Set<String>()

    init(engine: AVAudioEngine = AVAudioEngine()) {
        self.engine = engine
        let format = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 2)
        for name in names {
            let player = AVAudioPlayerNode()
            engine.attach(player)
            engine.connect(player, to: engine.mainMixerNode, format: format)
            players[name] = player
        }
        engine.mainMixerNode.outputVolume = 0.8
    }

    var available: [String] { names.filter { files[$0] != nil } }
    var hasDrumParts: Bool { Self.drumParts.allSatisfy { files[$0] != nil } }
    var duration: Double {
        guard let original = files["mix"] else { return 0 }
        return Double(original.length) / original.processingFormat.sampleRate
    }
    var position: Double { position(at: mach_absolute_time()) }
    var isPlaying: Bool { startTime != nil && position < duration }

    func publish(from directory: URL) {
        let host = nextStartTime()
        for name in names where files[name] == nil {
            let folder = Self.drumParts.contains(name) ? directory.appendingPathComponent("drum-parts") : directory
            let url = folder.appendingPathComponent(name + ".wav")
            guard FileManager.default.fileExists(atPath: url.path),
                  let audio = try? AVAudioFile(forReading: url) else { continue }
            files[name] = audio
            if isPlaying { schedule(name, at: position(at: host), host: host) }
        }
    }

    func setVolume(_ level: Float) {
        engine.mainMixerNode.outputVolume = level
    }

    func selectOriginal() {
        usesOriginal = true
        updateGains()
    }

    func selectStems() {
        usesOriginal = false
        if selected.isEmpty { pause() }
        updateGains()
    }

    func toggleStem(_ name: String) {
        guard Self.selectableNames.contains(name), files[name] != nil else { return }
        if Self.drumParts.contains(name) {
            guard hasDrumParts else { return }
            if selected.remove("drums") != nil { selected.formUnion(Self.drumParts) }
        }
        if name == "drums" && !selected.isDisjoint(with: Self.drumParts) {
            selected.subtract(Self.drumParts)
        } else if selected.remove(name) == nil {
            selected.insert(name)
        }
        selectStems()
    }

    func play(from seconds: Double? = nil) throws {
        guard duration > 0, usesOriginal || !selected.isEmpty else { return }
        if let seconds, seconds.isFinite {
            playhead = min(duration, max(0, seconds))
        }
        if playhead >= duration { playhead = 0 }

        stopPlayers()
        if !engine.isRunning { try engine.start() }
        let host = nextStartTime()
        for name in available {
            schedule(name, at: playhead, host: host)
        }
        startTime = host
        updateGains()
    }

    func pause() {
        playhead = position
        stopPlayers()
    }

    func seek(to seconds: Double) throws {
        let resume = isPlaying
        pause()
        playhead = max(0, min(seconds, duration))
        if resume && playhead < duration { try play() }
    }

    func reset() {
        stopPlayers()
        engine.stop()
        files.removeAll()
        playhead = 0
        usesOriginal = true
        selected.removeAll()
    }

    private func position(at host: UInt64) -> Double {
        guard let startTime, host > startTime else { return playhead }
        return min(duration, playhead + AVAudioTime.seconds(forHostTime: host - startTime))
    }

    private func nextStartTime() -> UInt64 {
        mach_absolute_time() + AVAudioTime.hostTime(forSeconds: 0.06)
    }

    private func schedule(_ name: String, at seconds: Double, host: UInt64) {
        guard let file = files[name], let player = players[name] else { return }
        let frame = AVAudioFramePosition(seconds * file.processingFormat.sampleRate)
        guard frame < file.length else { return }
        player.scheduleSegment(file, startingFrame: frame, frameCount: AVAudioFrameCount(file.length - frame), at: nil)
        player.play(at: AVAudioTime(hostTime: host))
        scheduled.insert(name)
    }

    private func stopPlayers() {
        for name in scheduled { players[name]?.stop() }
        scheduled.removeAll()
        startTime = nil
    }

    private func updateGains() {
        for (name, player) in players {
            player.volume = (usesOriginal ? name == "mix" : selected.contains(name)) ? 1 : 0
        }
    }
}
