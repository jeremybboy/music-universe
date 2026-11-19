import AppKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

let size: CGFloat = 1024
let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 255) / 255,
            green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: alpha)
}

func gradient(_ stops: [CGColor]) -> CGGradient {
    CGGradient(colorsSpace: colorSpace, colors: stops as CFArray, locations: nil)!
}

func glow(_ colors: [CGColor], center: CGPoint, radius: CGFloat, on ctx: CGContext) {
    ctx.drawRadialGradient(gradient(colors), startCenter: center, startRadius: 0,
                           endCenter: center, endRadius: radius, options: [])
}

func makeArtwork() -> CGImage {
    let ctx = CGContext(data: nil, width: Int(size), height: Int(size), bitsPerComponent: 8,
                        bytesPerRow: 0, space: colorSpace,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let tile = CGRect(x: 55, y: 55, width: 914, height: 914)
    let outline = CGPath(roundedRect: tile, cornerWidth: 208, cornerHeight: 208, transform: nil)

    ctx.saveGState()
    ctx.addPath(outline)
    ctx.clip()
    ctx.drawLinearGradient(gradient([color(0x180e2c), color(0x25143e), color(0x0d0a16)]),
                           start: CGPoint(x: 140, y: 940), end: CGPoint(x: 840, y: 70), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    glow([color(0x6632a6, 0.92), color(0x613699, 0.32), color(0x36266c, 0)],
         center: CGPoint(x: 250, y: 774), radius: 700, on: ctx)
    glow([color(0xfa547c, 0.78), color(0xa23c78, 0.42), color(0x6b246a, 0)],
         center: CGPoint(x: 808, y: 804), radius: 543, on: ctx)
    glow([color(0xffad78, 0.37), color(0xcf407a, 0.16), color(0x433275, 0)],
         center: CGPoint(x: 732, y: 734), radius: 420, on: ctx)

    ctx.saveGState()
    ctx.translateBy(x: 520, y: 706)
    ctx.rotate(by: .pi / 10)
    for ring in 0..<9 {
        let radius = CGFloat(ring)
        ctx.setStrokeColor(color(0xd7b7ff, 0.11 + radius * 0.006))
        ctx.setLineWidth(1.9)
        ctx.strokeEllipse(in: CGRect(x: -320 - radius * 13, y: -110 - radius * 10,
                                     width: 640 + radius * 26, height: 220 + radius * 20))
    }
    ctx.restoreGState()

    for row in 0..<9 {
        let wave = CGMutablePath()
        for point in 0...132 {
            let t = CGFloat(point) / 132
            let x = 144 + 736 * t
            let envelope = sin(t * .pi)
            let y = 687 + CGFloat(row - 4) * 12
                + envelope * (sin(t * 13 + CGFloat(row) * 0.10) * 78
                    + sin(t * 22 + 0.95) * 23)
            if point == 0 { wave.move(to: CGPoint(x: x, y: y)) }
            else { wave.addLine(to: CGPoint(x: x, y: y)) }
        }
        ctx.saveGState()
        ctx.addPath(wave)
        ctx.setLineWidth(row == 4 ? 13 : 4)
        ctx.setLineCap(.round)
        if row != 4 { ctx.setAlpha(0.61 - CGFloat(abs(row - 4)) * 0.06) }
        ctx.replacePathWithStrokedPath()
        ctx.clip()
        ctx.drawLinearGradient(gradient([color(0x925dfb), color(0xf9b1fc), color(0xffd0a2)]),
                               start: CGPoint(x: 144, y: 680), end: CGPoint(x: 880, y: 720), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
        ctx.restoreGState()
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
    for (text, y, fontSize, tracking) in [
        ("MUSIC", CGFloat(357), CGFloat(194), CGFloat(6)),
        ("UNIVERSE", CGFloat(190), CGFloat(130), CGFloat(4)),
    ] {
        let title = NSAttributedString(string: text, attributes: [
            .font: NSFont.systemFont(ofSize: fontSize, weight: .black),
            .foregroundColor: NSColor(cgColor: color(0xfff5f7))!,
            .kern: tracking,
        ])
        title.draw(at: CGPoint(x: (size - title.size().width) / 2, y: y))
    }
    NSGraphicsContext.restoreGraphicsState()
    ctx.restoreGState()
    ctx.addPath(outline)
    ctx.setLineWidth(4)
    ctx.setStrokeColor(color(0xe4b0ff, 0.42))
    ctx.strokePath()
    return ctx.makeImage()!
}

func writeIcon(_ original: CGImage, pixels: Int, url: URL) throws {
    let context = CGContext(data: nil, width: pixels, height: pixels, bitsPerComponent: 8,
                            bytesPerRow: 0, space: colorSpace,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.interpolationQuality = .high
    context.draw(original, in: CGRect(x: 0, y: 0, width: pixels, height: pixels))
    let output = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(output, context.makeImage()!, nil)
    if !CGImageDestinationFinalize(output) { throw CocoaError(.fileWriteUnknown) }
}

let destination = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
let artwork = makeArtwork()
for points in [16, 32, 128, 256, 512] {
    try writeIcon(artwork, pixels: points, url: destination.appendingPathComponent("icon_\(points)x\(points).png"))
    try writeIcon(artwork, pixels: points * 2, url: destination.appendingPathComponent("icon_\(points)x\(points)@2x.png"))
}
