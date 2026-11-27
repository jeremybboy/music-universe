import AppKit
import UniformTypeIdentifiers
import WebKit

@main
@MainActor
struct MusicUniverse {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) {
            app.run()
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply {
    private var window: NSWindow?
    private var playerURL: URL?
    private let trackAnalysis = TrackAnalysis()

    func applicationDidFinishLaunching(_ notification: Notification) {
        installMenu()
        guard let playerURL = Bundle.main.url(
            forResource: "index", withExtension: "html", subdirectory: "Player"
        ) else {
            showFailure("The bundled player is missing. Rebuild Music Universe from its project folder.")
            return
        }
        self.playerURL = playerURL

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "trackAnalysis")
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "openStrudel")
        let player = WKWebView(frame: .zero, configuration: configuration)
        player.navigationDelegate = self
        player.uiDelegate = self
        player.underPageBackgroundColor = NSColor(red: 15 / 255, green: 12 / 255, blue: 21 / 255, alpha: 1)
        player.loadFileURL(playerURL, allowingReadAccessTo: playerURL.deletingLastPathComponent())

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false
        )
        window.title = "Music Universe"
        window.contentMinSize = NSSize(width: 480, height: 485)
        window.tabbingMode = .disallowed
        window.contentView = player
        window.setFrameAutosaveName("MusicUniverseMainWindow")
        window.center()
        window.makeKeyAndOrderFront(nil)
        self.window = window
        NSApp.activate()
    }

    func applicationWillTerminate(_ notification: Notification) {
        trackAnalysis.cleanUp()
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) async -> (Any?, String?) {
        guard message.frameInfo.isMainFrame, let window,
              let current = message.frameInfo.request.url, current.isFileURL,
              current.standardizedFileURL.path == playerURL?.standardizedFileURL.path else {
            return (nil, "Native controls are unavailable for this page.")
        }
        if message.name == "openStrudel" {
            guard let source = message.body as? String,
                  !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  source.utf8.count <= 48_000 else { return (nil, "Choose a pattern to open in Strudel.") }
            let encoded = Data(source.utf8).base64EncodedString()
            var link = URLComponents()
            link.scheme = "https"
            link.host = "strudel.cc"
            link.path = "/"
            link.percentEncodedFragment = encoded.addingPercentEncoding(withAllowedCharacters:
                CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"))
            guard let url = link.url else { return (nil, "The Strudel link could not be encoded.") }
            trackAnalysis.pausePlayback()
            return (NSWorkspace.shared.open(url), nil)
        }
        guard let request = message.body as? [String: Any], let action = request["action"] as? String else {
            return (nil, "Local analysis is unavailable for this request.")
        }
        do {
            return (try await trackAnalysis.handle(action, message: request, window: window), nil)
        } catch {
            return (nil, error.localizedDescription)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = action.request.url,
              url.isFileURL,
              url.standardizedFileURL.path == playerURL?.standardizedFileURL.path else { return .cancel }
        return .allow
    }

    func webView(
        _ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo
    ) async -> [URL]? {
        guard frame.isMainFrame,
              let url = webView.url, url.isFileURL,
              url.standardizedFileURL.path == playerURL?.standardizedFileURL.path,
              let window = webView.window else { return nil }

        let panel = NSOpenPanel()
        panel.title = "Open a song package or analysis report"
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        let songType = UTType(filenameExtension: "muv", conformingTo: .data)
        panel.allowedContentTypes = [.json] + (songType.map { [$0] } ?? [])

        let response = await panel.beginSheetModal(for: window)
        guard response == .OK, let choice = panel.url,
              ["muv", "json"].contains(choice.pathExtension.lowercased()) else { return nil }
        return [choice]
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        trackAnalysis.pausePlayback()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showFailure("The bundled player could not open. Rebuild Music Universe from its project folder.")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        trackAnalysis.pausePlayback()
        guard let playerURL else { return }
        webView.loadFileURL(playerURL, allowingReadAccessTo: playerURL.deletingLastPathComponent())
    }

    private func showFailure(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Music Universe could not start"
        alert.informativeText = message
        alert.runModal()
        NSApp.terminate(nil)
    }

    private func installMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Music Universe", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Music Universe", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit Music Universe", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        for (title, selector, shortcut) in [
            ("Undo", "undo:", "z"), ("Redo", "redo:", "Z"),
            ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"),
            ("Select All", "selectAll:", "a"),
        ] {
            editMenu.addItem(withTitle: title, action: NSSelectorFromString(selector), keyEquivalent: shortcut)
        }
        editItem.submenu = editMenu
        menu.addItem(editItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowItem.submenu = windowMenu
        menu.addItem(windowItem)
        NSApp.windowsMenu = windowMenu
        NSApp.mainMenu = menu
    }
}
