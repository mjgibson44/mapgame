import AVFoundation
import SwiftUI

@main
struct MapGameApp: App {
    init() {
        // Sound effects mix with any music already playing and, like other
        // games, stay quiet while the silent switch is on.
        try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
    }

    var body: some Scene {
        WindowGroup {
            // The page pads itself for the notch and home indicator
            // (env(safe-area-inset-*)), so let it run edge to edge.
            GameWebView()
                .ignoresSafeArea()
        }
    }
}
