"use client";

import { useState } from "react";
import { apiSpec, staticEndpoints, supportedFormats } from "../lib/api/spec";
import { CodeBlock, EndpointCard, MethodBadge, ParamTable, TabButton } from "../components/docs";

type TabId = "overview" | "endpoints" | "static" | "types";

export default function Component() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  return (
    <main className="max-w-6xl mx-auto my-10 sm:my-14 px-5 sm:px-8">
      <div className="mb-10 max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary mb-3">
          Compendus docs
        </p>
        <h1 className="reading-title text-4xl sm:text-5xl text-foreground mb-3">{apiSpec.title}</h1>
        <p className="text-lg leading-relaxed text-foreground-muted">{apiSpec.description}</p>
        <p className="text-xs font-mono text-foreground-muted/70 mt-3">Version {apiSpec.version}</p>
      </div>

      {/* Tab Navigation */}
      <div className="sticky top-[var(--header-height)] z-20 flex flex-wrap gap-1 mb-8 p-1.5 bg-background/90 backdrop-blur-xl border border-border rounded-xl w-fit">
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
        <div className="space-y-5 max-w-4xl">
          <section className="quiet-panel p-5 sm:p-7">
            <h2 className="text-xl font-semibold text-foreground mb-3">Base URL</h2>
            <CodeBlock language="text">{apiSpec.baseUrl}</CodeBlock>
          </section>

          <section className="quiet-panel p-5 sm:p-7">
            <h2 className="text-xl font-semibold text-foreground mb-3">Authentication</h2>
            <p className="text-foreground">
              The API currently does not require authentication. It is designed for
              local/self-hosted deployments.
            </p>
          </section>

          <section className="quiet-panel p-5 sm:p-7">
            <h2 className="text-xl font-semibold text-foreground mb-3">CORS</h2>
            <p className="text-foreground mb-3">Cross-Origin Resource Sharing is enabled:</p>
            <CodeBlock>{`Access-Control-Allow-Origin: ${apiSpec.cors.origins}
Access-Control-Allow-Methods: ${apiSpec.cors.methods.join(", ")}
Access-Control-Allow-Headers: ${apiSpec.cors.headers.join(", ")}`}</CodeBlock>
          </section>

          <section className="quiet-panel p-5 sm:p-7">
            <h2 className="text-xl font-semibold text-foreground mb-3">Supported File Formats</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {Object.entries(supportedFormats.books.mimeTypes).map(([format, mimeType]) => (
                <div key={format} className="p-4 bg-background rounded-lg border border-border">
                  <h3 className="font-semibold text-foreground uppercase">{format}</h3>
                  <p className="text-xs text-foreground-muted font-mono">{mimeType}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="quiet-panel p-5 sm:p-7">
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
            All API endpoints are prefixed with{" "}
            <code className="bg-surface-elevated px-1 rounded border border-border">/api</code>.
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
            Static file endpoints serve book files, covers, and comic pages directly. These are not
            prefixed with{" "}
            <code className="bg-surface-elevated px-1 rounded border border-border">/api</code>.
          </p>
          {staticEndpoints.map((endpoint, i) => (
            <div key={i} className="border border-border rounded-lg mb-4 overflow-hidden">
              <div className="px-4 py-3 flex items-center gap-3 bg-surface-elevated">
                <MethodBadge method={endpoint.method} />
                <code className="text-sm font-mono text-foreground flex-1">{endpoint.path}</code>
                <span className="text-foreground-muted text-sm hidden sm:block">
                  {endpoint.summary}
                </span>
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
