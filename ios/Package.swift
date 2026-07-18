// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Nourish",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "NourishCore", targets: ["NourishCore"]),
        .library(name: "NourishAPI", targets: ["NourishAPI"]),
        .library(name: "NourishUI", targets: ["NourishUI"]),
        .executable(name: "NourishCoreChecks", targets: ["NourishCoreChecks"]),
    ],
    targets: [
        .target(name: "NourishCore"),
        .target(name: "NourishAPI", dependencies: ["NourishCore"]),
        .target(name: "NourishUI", dependencies: ["NourishCore", "NourishAPI"]),
        .executableTarget(name: "NourishCoreChecks", dependencies: ["NourishCore", "NourishAPI"]),
    ]
)
