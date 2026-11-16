// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "Setwise",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "SetwiseCore", targets: ["SetwiseCore"]),
    .library(name: "SetwisePlatform", targets: ["SetwisePlatform"]),
  ],
  dependencies: [
    .package(
      url: "https://github.com/alexeichhorn/YouTubeKit.git",
      revision: "7f75a2299dc329c0b7855afb25d47663a02855cb")
  ],
  targets: [
    .target(name: "SetwiseCore"),
    .target(
      name: "SetwisePlatform",
      dependencies: ["SetwiseCore", .product(name: "YouTubeKit", package: "YouTubeKit")],
      path: "App",
      exclude: ["SetwiseApp.swift", "LibraryView.swift", "Editors.swift", "ImportMusicView.swift"]),
    .testTarget(name: "SetwiseCoreTests", dependencies: ["SetwiseCore"]),
    .testTarget(name: "SetwisePlatformTests", dependencies: ["SetwisePlatform"]),
  ]
)
