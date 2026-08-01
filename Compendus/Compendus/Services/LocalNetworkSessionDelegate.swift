//
//  LocalNetworkSessionDelegate.swift
//  Compendus
//
//  Handles TLS certificate challenges for local network hosts (.local, localhost,
//  private IPs) by accepting self-signed certificates. This allows the app to
//  connect to self-hosted servers using HTTPS with self-signed certs.
//

import Foundation
import CryptoKit
import Security

class LocalNetworkSessionDelegate: NSObject, URLSessionDelegate {
    static let shared = LocalNetworkSessionDelegate()
    private static let pinPrefix = "compendus.tls.certificate."
    private static let pinLock = NSLock()

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let serverTrust = challenge.protectionSpace.serverTrust,
           Self.isLocalNetworkHost(challenge.protectionSpace.host) {
            guard let certificates = SecTrustCopyCertificateChain(serverTrust) as? [SecCertificate],
                  let certificate = certificates.first else {
                completionHandler(.cancelAuthenticationChallenge, nil)
                return
            }
            let fingerprint = SHA256.hash(data: SecCertificateCopyData(certificate) as Data)
                .map { String(format: "%02x", $0) }
                .joined()
            let host = challenge.protectionSpace.host.lowercased()
            let accepted = Self.pinLock.withLock {
                if let pinned = Self.pinnedFingerprint(for: host) {
                    return pinned == fingerprint
                }
                UserDefaults.standard.set(fingerprint, forKey: Self.pinKey(for: host))
                return true
            }
            if !accepted {
                completionHandler(.cancelAuthenticationChallenge, nil)
                return
            }
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

    static func pinnedFingerprint(for host: String) -> String? {
        UserDefaults.standard.string(forKey: pinKey(for: host.lowercased()))
    }

    static func clearPinnedCertificate(for host: String) {
        UserDefaults.standard.removeObject(forKey: pinKey(for: host.lowercased()))
    }

    private static func pinKey(for host: String) -> String {
        pinPrefix + host.data(using: .utf8, allowLossyConversion: false)!.base64EncodedString()
    }
}
