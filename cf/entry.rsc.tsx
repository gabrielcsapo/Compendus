import { fetchServer } from "../react-router-vite/entry.rsc";

export default {
  fetch(request: Request) {
    return fetchServer(request);
  },
};
