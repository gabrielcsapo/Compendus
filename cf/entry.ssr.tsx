import handler from "../react-router-vite/entry.ssr";

export default {
  async fetch(request: Request, env: any) {
    return handler(request, await env.RSC.fetch(request));
  },
};
