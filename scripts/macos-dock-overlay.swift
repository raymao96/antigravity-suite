// MIT License
//
// Copyright (c) 2026 Antigravity Context Viewer Contributors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import AppKit
import ApplicationServices
import CoreText
import Darwin
import Foundation

struct OverlayState: Equatable, Sendable {
    var visible: Bool = false
    var unread: Int = 0
    var approval: Int = 0
    var highRisk: Bool = false
    var running: Bool = false
    var style: String = "capsule"
    var colorTier: Bool = true
    var locale: String = "zh-CN"
}

struct OverlayCommand: Decodable, Sendable {
    var visible: Bool?
    var unread: Int?
    var approval: Int?
    var highRisk: Bool?
    var running: Bool?
    var style: String?
    var colorTier: Bool?
    var locale: String?
    var promptAccessibility: Bool?

    func toOverlayState() -> OverlayState {
        let cleanStyle = (style ?? "capsule").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let cleanLocale = (locale ?? "zh-CN").trimmingCharacters(in: .whitespacesAndNewlines)
        return OverlayState(
            visible: visible ?? false,
            unread: max(0, unread ?? 0),
            approval: max(0, approval ?? 0),
            highRisk: highRisk ?? false,
            running: running ?? false,
            style: cleanStyle == "badge" ? "badge" : "capsule",
            colorTier: colorTier ?? true,
            locale: cleanLocale.isEmpty ? "zh-CN" : cleanLocale
        )
    }
}

private func clampCGFloat(_ v: CGFloat, min lo: CGFloat, max hi: CGFloat) -> CGFloat {
    return Swift.max(lo, Swift.min(hi, v))
}

private func formatCapCount(_ count: Int) -> String {
    return count > 99 ? "99+" : "\(count)"
}

private enum CapsuleLayout {
    case hidden
    case statusDot(bgColor: NSColor, borderColor: NSColor, dotColor: NSColor?, text: String)
    case mixedSplit(unreadText: String, approvalText: String)
}

private func computeBadgeNumber(_ state: OverlayState) -> (badgeNum: Int, isUrgent: Bool) {
    let isUrgent = state.highRisk || state.approval > 0
    let badgeNum = isUrgent ? max(state.approval, state.highRisk ? 1 : 0) : state.unread
    return (max(0, badgeNum), isUrgent)
}

private func computeCapsuleLayout(_ state: OverlayState, iconSide: CGFloat) -> CapsuleLayout {
    guard state.style == "capsule", iconSide >= 40.0 else {
        return .hidden
    }
    let lowerLocale = state.locale.lowercased()
    let isEn = lowerLocale.hasPrefix("en")
    let isTw = lowerLocale.hasPrefix("zh-tw") || lowerLocale.hasPrefix("zh-hant") || lowerLocale.hasPrefix("zh-hk")
    let compact = iconSide < 50.0
    let darkBg = NSColor(srgbRed: 22.0 / 255.0, green: 24.0 / 255.0, blue: 30.0 / 255.0, alpha: 0.91)
    let darkBorder = NSColor.white.withAlphaComponent(0.24)
    let urgentBg = NSColor(srgbRed: 0xCC / 255.0, green: 0x29 / 255.0, blue: 0x20 / 255.0, alpha: 1.0)
    let urgentBorder = NSColor.white.withAlphaComponent(0.34)
    let redDot = NSColor(srgbRed: 1.0, green: 0x5E / 255.0, blue: 0x57 / 255.0, alpha: 1.0)

    if state.highRisk {
        let text = isEn ? (compact ? "Risk" : "High Risk") : (isTw ? (compact ? "高風險" : "高風險待審") : (compact ? "高危" : "高危待批"))
        return .statusDot(bgColor: urgentBg, borderColor: urgentBorder, dotColor: nil, text: text)
    }
    if state.approval > 0 && state.unread > 0 {
        if isEn {
            return .statusDot(bgColor: darkBg, borderColor: darkBorder, dotColor: redDot, text: "Approve")
        }
        if compact {
            return .statusDot(bgColor: darkBg, borderColor: darkBorder, dotColor: redDot, text: isTw ? "待審" : "待批")
        }
        let u = formatCapCount(state.unread)
        let a = formatCapCount(state.approval)
        return .mixedSplit(unreadText: "\(u)新", approvalText: isTw ? "\(a)審" : "\(a)批")
    }
    if state.approval > 0 && state.unread == 0 {
        let text = isEn ? "Approve" : (isTw ? (compact ? "待審" : "待審核") : (compact ? "待批" : "待审批"))
        return .statusDot(bgColor: darkBg, borderColor: darkBorder, dotColor: redDot, text: text)
    }
    if state.unread > 0 && state.approval == 0 {
        let dot = NSColor(srgbRed: 0x4D / 255.0, green: 0xA3 / 255.0, blue: 1.0, alpha: 1.0)
        let text = isEn ? "Unread" : (isTw ? (compact ? "未讀" : "新回覆") : (compact ? "未读" : "新回复"))
        return .statusDot(bgColor: darkBg, borderColor: darkBorder, dotColor: dot, text: text)
    }
    if state.running && state.unread == 0 && state.approval == 0 && !state.highRisk {
        let dot = NSColor(srgbRed: 0x38 / 255.0, green: 0xBD / 255.0, blue: 0xF8 / 255.0, alpha: 1.0)
        let text = isEn ? "Working" : "生成中"
        return .statusDot(bgColor: darkBg, borderColor: darkBorder, dotColor: dot, text: text)
    }
    return .hidden
}

private func hasDisplayableOverlay(_ state: OverlayState, iconSide: CGFloat) -> Bool {
    guard state.visible else { return false }
    let (badgeNum, _) = computeBadgeNumber(state)
    if badgeNum > 0 { return true }
    if case .hidden = computeCapsuleLayout(state, iconSide: iconSide) {
        return false
    }
    return true
}

@MainActor
final class DockOverlayView: NSView {
    var overlayState = OverlayState()
    var iconSide: CGFloat = 0
    var iconRectInView: NSRect = .zero
    var pad: CGFloat = 16.0

    override var isOpaque: Bool { false }

    private func measureLineInk(_ attrStr: NSAttributedString) -> (line: CTLine, ink: CGRect) {
        let line = CTLineCreateWithAttributedString(attrStr)
        var ink = CTLineGetBoundsWithOptions(line, .useGlyphPathBounds)
        if ink.isNull || ink.isEmpty || ink.width < 0.1 || ink.height < 0.1 {
            ink = CTLineGetBoundsWithOptions(line, .useOpticalBounds)
        }
        return (line, ink)
    }

    override func draw(_ dirtyRect: NSRect) {
        guard iconSide > 0, hasDisplayableOverlay(overlayState, iconSide: iconSide) else {
            return
        }
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }

        let iconRect = iconRectInView.width > 0
            ? iconRectInView
            : NSRect(x: pad, y: pad, width: iconSide, height: iconSide)
        drawBottomCapsule(in: iconRect, ctx: ctx)
        drawCornerBadge(in: iconRect, ctx: ctx)
    }

    private func drawCornerBadge(in iconRect: NSRect, ctx: CGContext) {
        let (badgeNum, isUrgent) = computeBadgeNumber(overlayState)
        guard badgeNum > 0 else { return }

        let label = formatCapCount(badgeNum)
        let fillColor: NSColor = (isUrgent || !overlayState.colorTier)
            ? NSColor(srgbRed: 0xCC / 255.0, green: 0x29 / 255.0, blue: 0x20 / 255.0, alpha: 1.0)
            : NSColor(srgbRed: 0x00 / 255.0, green: 0x66 / 255.0, blue: 0xCC / 255.0, alpha: 1.0)

        let badgeH = clampCGFloat(iconSide * 0.285, min: 15.0, max: 26.0)
        let fontSize = clampCGFloat(badgeH * 0.60, min: 9.5, max: 15.5)
        let font = NSFont.monospacedDigitSystemFont(ofSize: fontSize, weight: .semibold)
        let attrs: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: NSColor.white
        ]
        let attrStr = NSAttributedString(string: label, attributes: attrs)
        let (line, ink) = measureLineInk(attrStr)
        let badgeW = label.count <= 1
            ? badgeH
            : max(badgeH, ceil(ink.width + badgeH * 0.58))

        // 将角标贴近图标可视右上角（Squircle 内缩区域附近）同时限制不溢出绘制缓冲边界
        let targetMaxX = min(bounds.maxX - 4.0, iconRect.maxX - iconSide * 0.02 + badgeW * 0.12)
        let targetMaxY = min(bounds.maxY - 4.0, iconRect.maxY - iconSide * 0.02 + badgeH * 0.12)
        let badgeRect = NSRect(
            x: targetMaxX - badgeW,
            y: targetMaxY - badgeH,
            width: badgeW,
            height: badgeH
        )
        let radius = badgeH * 0.5
        let badgePath = NSBezierPath(roundedRect: badgeRect, xRadius: radius, yRadius: radius)

        // 轻微投影
        ctx.saveGState()
        let shadow = NSShadow()
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.38)
        shadow.shadowOffset = NSSize(width: 0, height: -1.5)
        shadow.shadowBlurRadius = 4.5
        shadow.set()
        fillColor.setFill()
        badgePath.fill()
        ctx.restoreGState()

        // 顶部微妙高光层
        ctx.saveGState()
        badgePath.addClip()
        if let gradient = NSGradient(
            starting: NSColor.white.withAlphaComponent(0.20),
            ending: NSColor.white.withAlphaComponent(0.0)
        ) {
            let highlightRect = NSRect(
                x: badgeRect.minX,
                y: badgeRect.midY,
                width: badgeRect.width,
                height: badgeRect.height * 0.5
            )
            gradient.draw(in: highlightRect, angle: -90.0)
        }
        ctx.restoreGState()

        // 1px 半透明白描边
        ctx.saveGState()
        let strokeRect = badgeRect.insetBy(dx: 0.5, dy: 0.5)
        let strokePath = NSBezierPath(
            roundedRect: strokeRect,
            xRadius: max(0, radius - 0.5),
            yRadius: max(0, radius - 0.5)
        )
        strokePath.lineWidth = 1.0
        NSColor.white.withAlphaComponent(0.34).setStroke()
        strokePath.stroke()
        ctx.restoreGState()

        // 基于字形真实墨迹边界光学居中数字
        ctx.saveGState()
        ctx.textMatrix = .identity
        ctx.textPosition = CGPoint(
            x: badgeRect.midX - (ink.minX + ink.width * 0.5),
            y: badgeRect.midY - (ink.minY + ink.height * 0.5)
        )
        CTLineDraw(line, ctx)
        ctx.restoreGState()
    }

    private func drawBottomCapsule(in iconRect: NSRect, ctx: CGContext) {
        let layout = computeCapsuleLayout(overlayState, iconSide: iconSide)
        if case .hidden = layout { return }

        let maxCapW = iconSide + 2.0
        let capH = clampCGFloat(iconSide * 0.238, min: 14.5, max: 20.5)
        let baseFontSize = clampCGFloat(capH * 0.56, min: 8.8, max: 11.2)
        let bottomOffset = max(2.5, iconSide * 0.055)

        var chosenFontSize = baseFontSize
        var hPadding: CGFloat = iconSide < 50.0 ? 5.0 : 6.5
        let dotDiameter: CGFloat = iconSide < 50.0 ? 4.2 : 4.8
        let dotGap: CGFloat = 3.5

        func buildContent(fontSize: CGFloat) -> (attr: NSAttributedString, dotColor: NSColor?, bgColor: NSColor, borderColor: NSColor) {
            let textFont = NSFont.monospacedDigitSystemFont(ofSize: fontSize, weight: .semibold)
            switch layout {
            case .hidden:
                return (NSAttributedString(), nil, .clear, .clear)
            case .statusDot(let bgColor, let borderColor, let dotColor, let text):
                let str = NSAttributedString(string: text, attributes: [
                    .font: textFont,
                    .foregroundColor: NSColor.white
                ])
                return (str, dotColor, bgColor, borderColor)
            case .mixedSplit(let unreadText, let approvalText):
                let darkBg = NSColor(srgbRed: 22.0 / 255.0, green: 24.0 / 255.0, blue: 30.0 / 255.0, alpha: 0.91)
                let darkBorder = NSColor.white.withAlphaComponent(0.24)
                let coral = NSColor(srgbRed: 1.0, green: 0x6B / 255.0, blue: 0x63 / 255.0, alpha: 1.0)
                let sepColor = NSColor.white.withAlphaComponent(0.48)
                let result = NSMutableAttributedString()
                result.append(NSAttributedString(string: unreadText, attributes: [
                    .font: textFont,
                    .foregroundColor: NSColor.white
                ]))
                result.append(NSAttributedString(string: "·", attributes: [
                    .font: textFont,
                    .foregroundColor: sepColor
                ]))
                result.append(NSAttributedString(string: approvalText, attributes: [
                    .font: textFont,
                    .foregroundColor: coral
                ]))
                return (result, nil, darkBg, darkBorder)
            }
        }

        var content = buildContent(fontSize: chosenFontSize)
        var measured = measureLineInk(content.attr)
        let dotSlotW = content.dotColor != nil ? (dotDiameter + dotGap) : 0.0
        var totalW = ceil(measured.ink.width + dotSlotW + hPadding * 2.0)

        // 若略超 maxCapW 则温和缩字号与边距，确保严格 <= iconSide + 2pt
        if totalW > maxCapW {
            for trialFont in stride(from: baseFontSize - 0.5, through: 8.0, by: -0.5) {
                let c = buildContent(fontSize: trialFont)
                let m = measureLineInk(c.attr)
                let padTry = max(4.0, hPadding - 1.5)
                let tw = ceil(m.ink.width + dotSlotW + padTry * 2.0)
                chosenFontSize = trialFont
                content = c
                measured = m
                hPadding = padTry
                totalW = tw
                if tw <= maxCapW { break }
            }
        }

        let capW = min(maxCapW, max(capH, totalW))
        let capRect = NSRect(
            x: iconRect.midX - capW * 0.5,
            y: iconRect.minY + bottomOffset,
            width: capW,
            height: capH
        )
        let capRadius = capH * 0.5
        let capPath = NSBezierPath(roundedRect: capRect, xRadius: capRadius, yRadius: capRadius)

        // 胶囊投影 + 磨砂底填充
        ctx.saveGState()
        let shadow = NSShadow()
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.34)
        shadow.shadowOffset = NSSize(width: 0, height: -1.0)
        shadow.shadowBlurRadius = 3.5
        shadow.set()
        content.bgColor.setFill()
        capPath.fill()
        ctx.restoreGState()

        // 顶部柔和玻璃高光
        ctx.saveGState()
        capPath.addClip()
        if let gradient = NSGradient(
            starting: NSColor.white.withAlphaComponent(0.11),
            ending: NSColor.white.withAlphaComponent(0.0)
        ) {
            let topBand = NSRect(
                x: capRect.minX,
                y: capRect.midY,
                width: capRect.width,
                height: capRect.height * 0.5
            )
            gradient.draw(in: topBand, angle: -90.0)
        }
        ctx.restoreGState()

        // 1px 浅白描边
        ctx.saveGState()
        let strokeRect = capRect.insetBy(dx: 0.5, dy: 0.5)
        let strokePath = NSBezierPath(
            roundedRect: strokeRect,
            xRadius: max(0, capRadius - 0.5),
            yRadius: max(0, capRadius - 0.5)
        )
        strokePath.lineWidth = 1.0
        content.borderColor.setStroke()
        strokePath.stroke()
        ctx.restoreGState()

        // 内容绘制裁剪在胶囊内部，并按字形真实墨迹边界光学居中
        ctx.saveGState()
        capRect.insetBy(dx: 2.0, dy: 1.0).clip()
        let ink = measured.ink
        let inkGroupW = dotSlotW + ink.width
        let groupStartX = capRect.midX - inkGroupW * 0.5

        if let dotColor = content.dotColor {
            let dotRect = NSRect(
                x: groupStartX,
                y: capRect.midY - dotDiameter * 0.5,
                width: dotDiameter,
                height: dotDiameter
            )
            dotColor.setFill()
            NSBezierPath(ovalIn: dotRect).fill()
        }

        let textStartX = groupStartX + dotSlotW
        ctx.textMatrix = .identity
        ctx.textPosition = CGPoint(
            x: textStartX - ink.minX,
            y: capRect.midY - (ink.minY + ink.height * 0.5)
        )
        CTLineDraw(measured.line, ctx)
        ctx.restoreGState()
    }
}

private struct DockTargetGeometry {
    var dockFound: Bool
    var iconRect: NSRect
    var iconSide: CGFloat
    var isOnScreen: Bool
}

@MainActor
final class OverlayController {
    static let shared = OverlayController()

    private let pad: CGFloat = 16.0
    private let window: NSWindow
    private let overlayView: DockOverlayView

    private var state = OverlayState()
    private var cachedDockPid: pid_t = 0
    private var cachedDockElement: AXUIElement?

    private var lastAxTrusted: Bool?
    private var lastDockFound: Bool?
    private var lastReportedIconSide: CGFloat = -1.0

    private var lastRectForMotion: NSRect?
    private var lastMotionTimestamp: TimeInterval = 0
    private var currentPollInterval: TimeInterval = 0
    private var pollTimer: DispatchSourceTimer?

    private init() {
        overlayView = DockOverlayView(frame: NSRect(x: 0, y: 0, width: 100, height: 100))
        overlayView.pad = pad

        let win = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 100, height: 100),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        win.isOpaque = false
        win.backgroundColor = .clear
        win.hasShadow = false
        win.ignoresMouseEvents = true
        win.isReleasedWhenClosed = false
        win.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.dockWindow)) + 2)
        win.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        win.contentView = overlayView
        window = win
    }

    func start() {
        tick(forceInitialReport: true)
    }

    func applyCommand(_ cmd: OverlayCommand) {
        if cmd.promptAccessibility == true {
            let opts = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(opts)
            tick(forceInitialReport: true)
            return
        }
        let next = cmd.toOverlayState()
        let changed = (next != state)
        state = next
        overlayView.overlayState = next
        if changed {
            tick(forceInitialReport: false)
        }
    }

    private func scheduleTimer(interval: TimeInterval) {
        if abs(currentPollInterval - interval) < 0.002, pollTimer != nil {
            return
        }
        pollTimer?.cancel()
        pollTimer = nil
        currentPollInterval = interval

        let timer = DispatchSource.makeTimerSource(queue: .main)
        let ms = max(16, Int((interval * 1000.0).rounded()))
        timer.schedule(
            deadline: .now() + .milliseconds(ms),
            repeating: .milliseconds(ms),
            leeway: .milliseconds(interval <= 0.05 ? 4 : 25)
        )
        timer.setEventHandler { [weak self] in
            self?.tick(forceInitialReport: false)
        }
        timer.resume()
        pollTimer = timer
    }

    private func tick(forceInitialReport: Bool) {
        let axTrusted = AXIsProcessTrusted()
        let geo: DockTargetGeometry = axTrusted
            ? locateAntigravityDockGeometry()
            : DockTargetGeometry(dockFound: false, iconRect: .zero, iconSide: 0, isOnScreen: false)

        reportStatusIfNeeded(
            axTrusted: axTrusted,
            dockFound: geo.dockFound,
            iconSide: geo.iconSide,
            force: forceInitialReport
        )

        let now = ProcessInfo.processInfo.systemUptime
        let shouldShow = axTrusted
            && geo.dockFound
            && geo.isOnScreen
            && hasDisplayableOverlay(state, iconSide: geo.iconSide)

        if shouldShow {
            if let prev = lastRectForMotion {
                let moved = abs(geo.iconRect.origin.x - prev.origin.x) > 0.1
                    || abs(geo.iconRect.origin.y - prev.origin.y) > 0.1
                    || abs(geo.iconSide - prev.width) > 0.1
                if moved {
                    lastMotionTimestamp = now
                }
            }
            lastRectForMotion = geo.iconRect

            // 将外框窗口显式对齐整数点，再将亚像素残差传给 View 内部补偿，避免 AppKit 向下取整导致左右偏心
            let winX = floor(geo.iconRect.minX - pad)
            let winY = floor(geo.iconRect.minY - pad)
            let winW = ceil(geo.iconRect.maxX + pad) - winX
            let winH = ceil(geo.iconRect.maxY + pad) - winY
            let winFrame = NSRect(x: winX, y: winY, width: winW, height: winH)
            if !window.frame.equalTo(winFrame) {
                window.setFrame(winFrame, display: false)
                overlayView.frame = NSRect(origin: .zero, size: window.frame.size)
            }
            let actualOrigin = window.frame.origin
            let nextIconRect = NSRect(
                x: geo.iconRect.minX - actualOrigin.x,
                y: geo.iconRect.minY - actualOrigin.y,
                width: geo.iconRect.width,
                height: geo.iconRect.height
            )
            overlayView.iconRectInView = nextIconRect
            overlayView.iconSide = geo.iconSide
            overlayView.overlayState = state
            overlayView.needsDisplay = true
            window.orderFrontRegardless()

            let inHighRefreshWindow = (now - lastMotionTimestamp) < 0.60
            scheduleTimer(interval: inHighRefreshWindow ? 0.033 : 0.125)
        } else {
            window.orderOut(nil)
            // 如果当前需要显示但只是 Dock 自动隐藏离屏，则保持 125ms 以便 Dock 滑出时立即跟上；其余空闲态降频至 1.5s
            let waitingForDockHover = state.visible && axTrusted && geo.dockFound && !geo.isOnScreen && hasDisplayableOverlay(state, iconSide: geo.iconSide)
            scheduleTimer(interval: waitingForDockHover ? 0.125 : 1.5)
        }
    }

    private func reportStatusIfNeeded(axTrusted: Bool, dockFound: Bool, iconSide: CGFloat, force: Bool) {
        let roundedSide = dockFound ? CGFloat(Int(iconSide.rounded())) : 0
        let trustedChanged = (lastAxTrusted != axTrusted)
        let dockChanged = (lastDockFound != dockFound)
        let sideChanged = abs(roundedSide - lastReportedIconSide) > 1.0

        guard force || trustedChanged || dockChanged || sideChanged else { return }

        lastAxTrusted = axTrusted
        lastDockFound = dockFound
        lastReportedIconSide = roundedSide

        let payload = "{\"type\":\"status\",\"pid\":\(getpid()),\"axTrusted\":\(axTrusted ? "true" : "false"),\"dockFound\":\(dockFound ? "true" : "false"),\"iconSide\":\(Int(roundedSide))}\n"
        fputs(payload, stdout)
        fflush(stdout)
    }

    private func resolveDockElement() -> AXUIElement? {
        guard let dockApp = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.dock").first else {
            cachedDockPid = 0
            cachedDockElement = nil
            return nil
        }
        let pid = dockApp.processIdentifier
        if pid != cachedDockPid || cachedDockElement == nil {
            cachedDockPid = pid
            cachedDockElement = AXUIElementCreateApplication(pid)
        }
        return cachedDockElement
    }

    private func copyAXAttribute(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
        var value: CFTypeRef?
        let err = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        guard err == .success else { return nil }
        return value
    }

    private func axString(_ element: AXUIElement, _ attribute: String) -> String? {
        guard let ref = copyAXAttribute(element, attribute),
              CFGetTypeID(ref) == CFStringGetTypeID() else {
            return nil
        }
        return ref as? String
    }

    private func axURL(_ element: AXUIElement) -> URL? {
        guard let ref = copyAXAttribute(element, kAXURLAttribute) else { return nil }
        if CFGetTypeID(ref) == CFURLGetTypeID() {
            return ref as? URL
        }
        if CFGetTypeID(ref) == CFStringGetTypeID(), let s = ref as? String {
            return URL(string: s)
        }
        return nil
    }

    private func axBool(_ element: AXUIElement, _ attribute: String) -> Bool {
        guard let ref = copyAXAttribute(element, attribute),
              CFGetTypeID(ref) == CFBooleanGetTypeID(),
              let flag = ref as? Bool else {
            return false
        }
        return flag
    }

    private func axChildren(_ element: AXUIElement) -> [AXUIElement] {
        guard let ref = copyAXAttribute(element, kAXChildrenAttribute),
              CFGetTypeID(ref) == CFArrayGetTypeID(),
              let arr = ref as? [AXUIElement] else {
            return []
        }
        return arr
    }

    private func axPointAndSize(_ element: AXUIElement) -> (CGPoint, CGSize)? {
        guard let posRef = copyAXAttribute(element, kAXPositionAttribute),
              let sizeRef = copyAXAttribute(element, kAXSizeAttribute),
              CFGetTypeID(posRef) == AXValueGetTypeID(),
              CFGetTypeID(sizeRef) == AXValueGetTypeID() else {
            return nil
        }
        let posVal = posRef as! AXValue
        let sizeVal = sizeRef as! AXValue
        guard AXValueGetType(posVal) == .cgPoint,
              AXValueGetType(sizeVal) == .cgSize else {
            return nil
        }
        var pt = CGPoint.zero
        var sz = CGSize.zero
        guard AXValueGetValue(posVal, .cgPoint, &pt),
              AXValueGetValue(sizeVal, .cgSize, &sz) else {
            return nil
        }
        return (pt, sz)
    }

    private func isAntigravityDockItem(_ item: AXUIElement) -> Bool {
        guard axString(item, kAXSubroleAttribute) == "AXApplicationDockItem" else {
            return false
        }
        if let url = axURL(item), url.path.lowercased().contains("/antigravity.app") {
            return true
        }
        if let title = axString(item, kAXTitleAttribute), title.lowercased().contains("antigravity") {
            return true
        }
        return false
    }

    private func findDockTargetElement() -> (item: AXUIElement, isHorizontal: Bool?)? {
        guard let dockApp = resolveDockElement() else { return nil }
        let topChildren = axChildren(dockApp)
        var candidateLists: [AXUIElement] = []

        for child in topChildren {
            if axString(child, kAXRoleAttribute) == kAXListRole {
                candidateLists.append(child)
            }
        }
        // 兜底：部分系统版本 AXList 可能在二级容器下
        if candidateLists.isEmpty {
            for child in topChildren {
                for grand in axChildren(child) {
                    if axString(grand, kAXRoleAttribute) == kAXListRole {
                        candidateLists.append(grand)
                    }
                }
            }
        }

        var fallbackMatch: (item: AXUIElement, isHorizontal: Bool?)?
        for listEl in candidateLists {
            let listOri = axString(listEl, kAXOrientationAttribute)
            let isHorizontal: Bool? = (listOri == "AXHorizontalOrientation")
                ? true
                : (listOri == "AXVerticalOrientation" ? false : nil)
            for item in axChildren(listEl) {
                if isAntigravityDockItem(item) {
                    if axBool(item, kAXIsApplicationRunningAttribute) {
                        return (item, isHorizontal)
                    }
                    if fallbackMatch == nil {
                        fallbackMatch = (item, isHorizontal)
                    }
                }
            }
        }
        return fallbackMatch
    }

    private func locateAntigravityDockGeometry() -> DockTargetGeometry {
        guard let target = findDockTargetElement(),
              let (axPos, axSize) = axPointAndSize(target.item),
              axSize.width > 1.0,
              axSize.height > 1.0 else {
            return DockTargetGeometry(dockFound: false, iconRect: .zero, iconSide: 0, isOnScreen: false)
        }

        let primaryH = NSScreen.screens.first?.frame.height ?? 0
        let cocoaOriginY = primaryH - axPos.y - axSize.height
        let iconSide = min(axSize.width, axSize.height)
        let isHorizontalDock = target.isHorizontal ?? (axSize.height >= axSize.width)

        let iconRect: NSRect
        if isHorizontalDock {
            // 底部 Dock：水平始终以 AX 项中线居中，垂直扣除底缘 running dot 占位
            iconRect = NSRect(
                x: axPos.x + (axSize.width - iconSide) * 0.5,
                y: cocoaOriginY + (axSize.height - iconSide),
                width: iconSide,
                height: iconSide
            )
        } else {
            // 左/右垂直 Dock：垂直居中，水平按所在屏幕左/右半侧贴齐图标可视区
            let rawCenter = NSPoint(x: axPos.x + axSize.width * 0.5, y: cocoaOriginY + axSize.height * 0.5)
            let ownerScreen = NSScreen.screens.first(where: { $0.frame.contains(rawCenter) }) ?? NSScreen.screens.first
            let onLeftSide = ownerScreen.map { rawCenter.x < $0.frame.midX } ?? (axPos.x < 120.0)
            let originX = onLeftSide ? (axPos.x + (axSize.width - iconSide)) : axPos.x
            iconRect = NSRect(
                x: originX,
                y: cocoaOriginY + (axSize.height - iconSide) * 0.5,
                width: iconSide,
                height: iconSide
            )
        }

        let minVisibleArea = iconSide * iconSide * 0.45
        var isOnScreen = false
        for screen in NSScreen.screens {
            let intersection = iconRect.intersection(screen.frame)
            if !intersection.isNull && !intersection.isEmpty {
                let area = intersection.width * intersection.height
                if area >= minVisibleArea {
                    isOnScreen = true
                    break
                }
            }
        }

        return DockTargetGeometry(
            dockFound: true,
            iconRect: iconRect,
            iconSide: iconSide,
            isOnScreen: isOnScreen
        )
    }
}

private func attachControlSocket(_ path: String) -> Bool {
    var address = sockaddr_un()
    let bytes = Array(path.utf8CString)
    guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { return false }
    address.sun_family = sa_family_t(AF_UNIX)
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    withUnsafeMutableBytes(of: &address.sun_path) { destination in
        bytes.withUnsafeBytes { destination.copyBytes(from: $0) }
    }
    let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return false }
    defer { Darwin.close(fd) }
    let connected = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
    guard connected == 0 else { return false }
    return dup2(fd, STDIN_FILENO) >= 0 && dup2(fd, STDOUT_FILENO) >= 0
}

@MainActor
private func runOverlayMain() {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)

    let args = CommandLine.arguments
    if args.contains("--request-accessibility") {
        let opts = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(opts)
        return
    }
    if let index = args.firstIndex(of: "--socket") {
        guard args.indices.contains(index + 1), attachControlSocket(args[index + 1]) else {
            Darwin.exit(1)
        }
    }
    signal(SIGTERM, SIG_IGN)
    signal(SIGINT, SIG_IGN)
    signal(SIGPIPE, SIG_IGN)

    let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    sigterm.setEventHandler {
        MainActor.assumeIsolated {
            NSApp.terminate(nil)
        }
    }
    sigterm.resume()

    let sigint = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
    sigint.setEventHandler {
        MainActor.assumeIsolated {
            NSApp.terminate(nil)
        }
    }
    sigint.resume()

    OverlayController.shared.start()

    DispatchQueue.global(qos: .utility).async {
        let decoder = JSONDecoder()
        while let rawLine = readLine(strippingNewline: true) {
            let trimmed = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { continue }
            guard let data = trimmed.data(using: .utf8),
                  let cmd = try? decoder.decode(OverlayCommand.self, from: data) else {
                continue
            }
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    OverlayController.shared.applyCommand(cmd)
                }
            }
        }
        // stdin EOF: 在主线程立即退出并唤醒 AppKit 事件循环
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                NSApp.terminate(nil)
                if let wake = NSEvent.otherEvent(
                    with: .applicationDefined,
                    location: .zero,
                    modifierFlags: [],
                    timestamp: 0,
                    windowNumber: 0,
                    context: nil,
                    subtype: 0,
                    data1: 0,
                    data2: 0
                ) {
                    NSApp.postEvent(wake, atStart: true)
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
                Darwin.exit(0)
            }
        }
    }

    withExtendedLifetime((sigterm, sigint)) {
        app.run()
    }
}

MainActor.assumeIsolated {
    runOverlayMain()
}
