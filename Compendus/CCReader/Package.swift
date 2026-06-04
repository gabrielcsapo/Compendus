// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CCReader",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "CCReader", targets: ["CCReader"]),
    ],
    dependencies: [
        .package(url: "https://github.com/weichsel/ZIPFoundation.git", from: "0.9.19"),
        .package(url: "https://github.com/scinfu/SwiftSoup.git", from: "2.7.0"),
    ],
    targets: [
        .target(
            name: "CCReader",
            dependencies: ["ZIPFoundation", "SwiftSoup"],
            path: "Sources/CCReader",
            resources: [
                // Bundled fonts referenced by ReaderSettings (OpenDyslexic, etc.)
                .process("Resources"),
            ]
        ),
        .testTarget(
            name: "CCReaderTests",
            dependencies: ["CCReader", "SwiftSoup"],
            path: "Tests/CCReaderTests",
            resources: [
                .copy("Samples"),
            ]
        ),
    ]
)
