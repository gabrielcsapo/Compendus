import { Routes, Route } from "react-router";
import { LandingLayout } from "./components/LandingLayout";
import { DocsLayout } from "./components/DocsLayout";
import { MdxPage } from "./components/MdxPage";

// MDX content pages
import GettingStartedContent from "@content/getting-started.mdx";
import ArchitectureContent from "@content/architecture.mdx";
import IOSContent from "@content/ios.mdx";

// TSX pages
import Landing from "./pages/Landing";
import ApiReference from "./pages/ApiReference";
import Formats from "./pages/Formats";
import AudioSpeech from "./pages/AudioSpeech";

export default function App() {
  return (
    <Routes>
      {/* Product landing page — standalone layout, no sidebar */}
      <Route element={<LandingLayout />}>
        <Route index element={<Landing />} />
      </Route>

      {/* Documentation — sidebar layout */}
      <Route path="docs" element={<DocsLayout />}>
        <Route
          index
          element={<MdxPage Component={GettingStartedContent} />}
        />
        <Route
          path="getting-started"
          element={<MdxPage Component={GettingStartedContent} />}
        />
        <Route
          path="architecture"
          element={<MdxPage Component={ArchitectureContent} />}
        />
        <Route path="ios" element={<MdxPage Component={IOSContent} />} />
        <Route path="api" element={<ApiReference />} />
        <Route path="formats" element={<Formats />} />
        <Route path="audio-speech" element={<AudioSpeech />} />
      </Route>
    </Routes>
  );
}
