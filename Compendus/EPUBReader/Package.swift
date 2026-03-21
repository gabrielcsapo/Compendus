// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "EPUBReader",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "EPUBReader", targets: ["EPUBReader"]),
    ],
    dependencies: [
        .package(url: "https://github.com/weichsel/ZIPFoundation.git", from: "0.9.19"),
        .package(url: "https://github.com/scinfu/SwiftSoup.git", from: "2.7.0"),
    ],
    targets: [
        .target(
            name: "EPUBReader",
            dependencies: ["ZIPFoundation", "SwiftSoup"],
            path: "Sources/EPUBReader",
            resources: [
                // Bundled fonts referenced by ReaderSettings (OpenDyslexic, etc.)
                .process("Resources"),
            ]
        ),
        .testTarget(
            name: "EPUBReaderTests",
            dependencies: ["EPUBReader"],
            path: "Tests/EPUBReaderTests",
            resources: [
                .copy("Samples"),
            ]
        ),
    ]
)
