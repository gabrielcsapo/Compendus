import { useState } from "react";
import { apiSpec, staticEndpoints, supportedFormats } from "@app/lib/api/spec";
import { CodeBlock, EndpointCard, MethodBadge, ParamTable, TabButton } from "@app/components/docs";

type TabId = "overview" | "endpoints" | "static" | "types";

export default function ApiReference() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="reading-title mb-3 text-4xl leading-tight text-foreground sm:text-5xl">
          {apiSpec.title}
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-foreground-muted">{apiSpec.description}</p>
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
              The API currently does not require authentication. It is designed for
              local/self-hosted deployments.
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
                <div
                  key={format}
                  className="p-4 bg-surface-elevated rounded-lg border border-border"
                >
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
    </div>
  );
}
