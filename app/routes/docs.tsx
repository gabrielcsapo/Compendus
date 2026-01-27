"use client";

import React, { useState } from "react";
import { apiSpec, staticEndpoints, supportedFormats, type EndpointSpec, type ParamSpec } from "../lib/api/spec";

type TabId = "overview" | "endpoints" | "static" | "types";

function CodeBlock({ children, language = "json" }: { children: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <pre className="code-block">
        <code className={`language-${language}`}>{children}</code>
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 px-2 py-1 text-xs bg-surface-elevated hover:bg-border text-foreground-muted rounded opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: "badge-success",
    POST: "badge-primary",
    PUT: "badge-warning",
    DELETE: "badge-danger",
    OPTIONS: "badge-neutral",
  };

  return (
    <span className={`px-2 py-1 text-xs font-mono font-semibold rounded ${colors[method] || colors.GET}`}>
      {method}
    </span>
  );
}

function ParamTable({ params, title }: { params: ParamSpec[]; title: string }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground mb-2">{title}</h4>
      <div className="space-y-2">
        {params.map((param) => (
          <div key={param.name} className="flex items-start gap-2 text-sm flex-wrap">
            <code className="bg-surface-elevated px-1.5 py-0.5 rounded text-foreground">{param.name}</code>
            <span className="text-foreground-muted">({param.type})</span>
            {param.required && <span className="text-danger text-xs font-medium">required</span>}
            {param.default !== undefined && (
              <span className="text-foreground-muted/70 text-xs">default: {String(param.default)}</span>
            )}
            {param.constraints && (
              <span className="text-foreground-muted/70 text-xs">
                {param.constraints.min !== undefined && `min: ${param.constraints.min}`}
                {param.constraints.max !== undefined && ` max: ${param.constraints.max}`}
                {param.constraints.minLength !== undefined && `minLength: ${param.constraints.minLength}`}
              </span>
            )}
            <span className="text-foreground-muted w-full">— {param.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EndpointCard({ endpoint }: { endpoint: EndpointSpec }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border rounded-lg mb-4 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-surface-elevated transition-colors text-left"
      >
        <MethodBadge method={endpoint.method} />
        <code className="text-sm font-mono text-foreground flex-1">{endpoint.path}</code>
        <span className="text-foreground-muted text-sm hidden sm:block">{endpoint.summary}</span>
        <svg
          className={`w-5 h-5 text-foreground-muted transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 py-4 border-t border-border bg-surface-elevated space-y-4">
          {endpoint.description && <p className="text-foreground">{endpoint.description}</p>}

          {endpoint.pathParams && endpoint.pathParams.length > 0 && (
            <ParamTable params={endpoint.pathParams} title="Path Parameters" />
          )}

          {endpoint.queryParams && endpoint.queryParams.length > 0 && (
            <ParamTable params={endpoint.queryParams} title="Query Parameters" />
          )}

          {endpoint.requestBody && (
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-2">Request Body</h4>
              <p className="text-sm text-foreground-muted mb-2">
                Content-Type: <code className="bg-surface px-1 rounded border border-border">{endpoint.requestBody.contentType}</code>
              </p>
              <p className="text-sm text-foreground-muted mb-2">{endpoint.requestBody.description}</p>
              {endpoint.requestBody.fields && (
                <ParamTable params={endpoint.requestBody.fields} title="Fields" />
              )}
            </div>
          )}

          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Success Response</h4>
            <p className="text-sm text-foreground-muted mb-2">
              Status: <code className="badge-success px-1 rounded">{endpoint.responses.success.status}</code>
              {" — "}{endpoint.responses.success.description}
            </p>
            <p className="text-sm text-foreground-muted mb-2">
              Returns: <code className="bg-surface-elevated px-1 rounded">{endpoint.responses.success.schema}</code>
            </p>
            {endpoint.responses.success.example && (
              <CodeBlock>{JSON.stringify(endpoint.responses.success.example, null, 2)}</CodeBlock>
            )}
          </div>

          {endpoint.responses.errors.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-2">Error Responses</h4>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-foreground-muted">
                      <th className="pr-4 py-1">Status</th>
                      <th className="pr-4 py-1">Code</th>
                      <th className="py-1">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {endpoint.responses.errors.map((error) => (
                      <tr key={error.code}>
                        <td className="pr-4 py-1">
                          <code className="badge-danger px-1 rounded">{error.status}</code>
                        </td>
                        <td className="pr-4 py-1">
                          <code className="bg-surface-elevated px-1 rounded">{error.code}</code>
                        </td>
                        <td className="py-1 text-foreground-muted">{error.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
        active ? "bg-primary-light text-primary" : "text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
      }`}
    >
      {children}
    </button>
  );
}

export function Component() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  return (
    <main className="container my-8 px-4 sm:px-8 mx-auto max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">{apiSpec.title}</h1>
        <p className="text-foreground-muted">{apiSpec.description}</p>
        <p className="text-sm text-foreground-muted/70 mt-2">Version {apiSpec.version}</p>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-2 mb-6 pb-4 border-b border-border">
        <TabButton active={activeTab === "overview"} onClick={() => setActiveTab("overview")}>
          Overview
        </TabButton>
        <TabButton active={activeTab === "endpoints"} onClick={() => setActiveTab("endpoints")}>
          API Endpoints
        </TabButton>
        <TabButton active={activeTab === "static"} onClick={() => setActiveTab("static")}>
          Static Files
        </TabButton>
        <TabButton active={activeTab === "types"} onClick={() => setActiveTab("types")}>
          Types
        </TabButton>
      </div>

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">Base URL</h2>
            <CodeBlock language="text">{apiSpec.baseUrl}</CodeBlock>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">Authentication</h2>
            <p className="text-foreground">
              The API currently does not require authentication. It is designed for local/self-hosted deployments.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">CORS</h2>
            <p className="text-foreground mb-3">Cross-Origin Resource Sharing is enabled:</p>
            <CodeBlock>{`Access-Control-Allow-Origin: ${apiSpec.cors.origins}
Access-Control-Allow-Methods: ${apiSpec.cors.methods.join(", ")}
Access-Control-Allow-Headers: ${apiSpec.cors.headers.join(", ")}`}</CodeBlock>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">Supported File Formats</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {Object.entries(supportedFormats.books.mimeTypes).map(([format, mimeType]) => (
                <div key={format} className="p-4 bg-surface-elevated rounded-lg border border-border">
                  <h3 className="font-semibold text-foreground uppercase">{format}</h3>
                  <p className="text-xs text-foreground-muted font-mono">{mimeType}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">Error Response Format</h2>
            <p className="text-foreground mb-3">All errors follow a consistent format:</p>
            <CodeBlock>{apiSpec.types.ApiErrorResponse.schema}</CodeBlock>
          </section>
        </div>
      )}

      {/* Endpoints Tab */}
      {activeTab === "endpoints" && (
        <div>
          <p className="text-foreground mb-6">
            All API endpoints are prefixed with <code className="bg-surface-elevated px-1 rounded border border-border">/api</code>.
          </p>
          {apiSpec.endpoints.map((endpoint, i) => (
            <EndpointCard key={i} endpoint={endpoint} />
          ))}
        </div>
      )}

      {/* Static Files Tab */}
      {activeTab === "static" && (
        <div>
          <p className="text-foreground mb-6">
            Static file endpoints serve book files, covers, and comic pages directly. These are not prefixed with <code className="bg-surface-elevated px-1 rounded border border-border">/api</code>.
          </p>
          {staticEndpoints.map((endpoint, i) => (
            <div key={i} className="border border-border rounded-lg mb-4 overflow-hidden">
              <div className="px-4 py-3 flex items-center gap-3 bg-surface-elevated">
                <MethodBadge method={endpoint.method} />
                <code className="text-sm font-mono text-foreground flex-1">{endpoint.path}</code>
                <span className="text-foreground-muted text-sm hidden sm:block">{endpoint.summary}</span>
              </div>
              <div className="px-4 py-3 border-t border-border">
                <p className="text-sm text-foreground-muted mb-2">{endpoint.description}</p>
                {endpoint.pathParams && (
                  <ParamTable params={endpoint.pathParams} title="Path Parameters" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Types Tab */}
      {activeTab === "types" && (
        <div className="space-y-6">
          {Object.entries(apiSpec.types).map(([name, type]) => (
            <section key={name}>
              <h2 className="text-xl font-semibold text-foreground mb-2">{name}</h2>
              <p className="text-foreground-muted text-sm mb-3">{type.description}</p>
              <CodeBlock language="typescript">{type.schema}</CodeBlock>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
