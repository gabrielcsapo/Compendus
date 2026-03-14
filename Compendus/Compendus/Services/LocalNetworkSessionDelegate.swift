//
//  LocalNetworkSessionDelegate.swift
//  Compendus
//
//  Handles TLS certificate challenges for local network hosts (.local, localhost,
//  private IPs) by accepting self-signed certificates. This allows the app to
//  connect to self-hosted servers using HTTPS with self-signed certs.
//

import Foundation

class LocalNetworkSessionDelegate: NSObject, URLSessionDelegate {
    static let shared = LocalNetworkSessionDelegate()

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let serverTrust = challenge.protectionSpace.serverTrust,
           Self.isLocalNetworkHost(challenge.protectionSpace.host) {
            completionHandler(.useCredential, URLCredential(trust: serverTrust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }

    static func isLocalNetworkHost(_ host: String) -> Bool {
        host.hasSuffix(".local") ||
        host == "localhost" ||
        host == "127.0.0.1" ||
        host == "::1" ||
        host.hasPrefix("192.168.") ||
        host.hasPrefix("10.")
    }
}
