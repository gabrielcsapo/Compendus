//
//  GoalRing.swift
//  Compendus
//
//  Circular progress ring for the daily reading goal.
//  Mirrors the web `<GoalRing>` component so the at-a-glance UI feels the
//  same on both platforms (Duolingo-style: ring fills as you read, turns
//  green when the daily goal is hit).
//

import SwiftUI

struct GoalRing<Content: View>: View {
    let value: Double
    let goal: Double
    var size: CGFloat = 36
    var lineWidth: CGFloat = 3
    var trackColor: Color = .secondary.opacity(0.18)
    var progressColor: Color = .accentColor
    var completedColor: Color = .green
    @ViewBuilder var content: () -> Content

    private var progress: Double {
        let g = max(1, goal)
        return min(max(value / g, 0), 1)
    }

    private var completed: Bool { value >= max(1, goal) }

    var body: some View {
        ZStack {
            Circle()
                .stroke(trackColor, lineWidth: lineWidth)

            Circle()
                .trim(from: 0, to: progress)
                .stroke(
                    completed ? completedColor : progressColor,
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .animation(.easeOut(duration: 0.6), value: progress)

            content()
        }
        .frame(width: size, height: size)
        .accessibilityLabel("\(Int(progress * 100)) percent of daily reading goal")
        .accessibilityValue(completed ? "Goal reached" : "")
    }
}

extension GoalRing where Content == EmptyView {
    init(
        value: Double,
        goal: Double,
        size: CGFloat = 36,
        lineWidth: CGFloat = 3,
        trackColor: Color = .secondary.opacity(0.18),
        progressColor: Color = .accentColor,
        completedColor: Color = .green
    ) {
        self.value = value
        self.goal = goal
        self.size = size
        self.lineWidth = lineWidth
        self.trackColor = trackColor
        self.progressColor = progressColor
        self.completedColor = completedColor
        self.content = { EmptyView() }
    }
}
