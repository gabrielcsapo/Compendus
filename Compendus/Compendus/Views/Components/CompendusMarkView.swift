import SwiftUI

private struct CompendusPageShape: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 128
        let sy = rect.height / 128
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * sx, y: y * sy) }

        var path = Path()
        path.move(to: point(32, 16))
        path.addLine(to: point(76, 16))
        path.addCurve(to: point(112, 52), control1: point(96, 16), control2: point(112, 32))
        path.addLine(to: point(112, 80))
        path.addCurve(to: point(80, 112), control1: point(112, 98), control2: point(98, 112))
        path.addLine(to: point(32, 112))
        path.addCurve(to: point(16, 96), control1: point(23, 112), control2: point(16, 105))
        path.addLine(to: point(16, 32))
        path.addCurve(to: point(32, 16), control1: point(16, 23), control2: point(23, 16))
        path.closeSubpath()
        return path
    }
}

private struct CompendusBookmarkShape: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 128
        let sy = rect.height / 128
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * sx, y: y * sy) }

        var path = Path()
        path.move(to: point(40, 8))
        path.addLine(to: point(60, 8))
        path.addLine(to: point(60, 50))
        path.addCurve(to: point(40, 50), control1: point(60, 63), control2: point(40, 63))
        path.closeSubpath()
        return path
    }
}

struct CompendusMarkView: View {
    var size: CGFloat = 64
    var lineColor: Color = .primary

    var body: some View {
        ZStack {
            CompendusPageShape()
                .stroke(lineColor, style: StrokeStyle(lineWidth: size / 16, lineJoin: .round))
            CompendusBookmarkShape()
                .fill(Color(red: 241.0 / 255.0, green: 200.0 / 255.0, blue: 75.0 / 255.0))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

#Preview {
    CompendusMarkView(size: 96)
        .padding()
}
