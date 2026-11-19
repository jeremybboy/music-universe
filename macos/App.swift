import AppKit
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
final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow?
    private var playerURL: URL?

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

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = action.request.url,
              url.isFileURL,
              url.standardizedFileURL.path == playerURL?.standardizedFileURL.path else { return .cancel }
        return .allow
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showFailure("The bundled player could not open. Rebuild Music Universe from its project folder.")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
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
