import SwiftUI
import WebKit

/// Runs the web game bundled into the app (the repo's .html/.css/.js files,
/// copied to `web/` by the "Bundle web game" build phase), fully offline.
struct GameWebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // Tell the page it's in the app, so it swaps the system keyboard for
        // the game's own (setupKeyboard in shared.js).
        config.userContentController.addUserScript(WKUserScript(
            source: "document.documentElement.classList.add('native-app');",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = context.coordinator
        webView.navigationDelegate = context.coordinator
        // Match the page's paper colour so there's no white flash on launch.
        let paper = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0x13 / 255, green: 0x13 / 255, blue: 0x11 / 255, alpha: 1)
                : UIColor(red: 0xFA / 255, green: 0xFA / 255, blue: 0xF8 / 255, alpha: 1)
        }
        webView.isOpaque = false
        webView.backgroundColor = paper
        webView.scrollView.backgroundColor = paper
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        guard let webDir = Bundle.main.url(forResource: "web", withExtension: nil) else {
            assertionFailure("web/ missing from the app bundle — check the Bundle web game build phase")
            return webView
        }
        // Always open on the home page, where you pick a mode.
        webView.loadFileURL(webDir.appendingPathComponent("index.html"), allowingReadAccessTo: webDir)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        // Links off the bundled game open in Safari, not inside the app.
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            if let url = navigationAction.request.url, !url.isFileURL, url.scheme != "about" {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        // Voice answers: the app's own microphone prompt (Info.plist) already
        // asked, so don't make the web view ask a second time.
        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            decisionHandler(.grant)
        }
    }
}
