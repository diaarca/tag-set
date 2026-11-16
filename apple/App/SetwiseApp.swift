import SetwiseCore
import SwiftUI

@main
@MainActor
struct SetwiseApp: App {
  @StateObject private var library = NativeLibraryStore()
  @StateObject private var player = AudioPlayer()
  var body: some Scene {
    WindowGroup { LibraryView().environmentObject(library).environmentObject(player) }
  }
}
