"use client";

import React from "react";
import { buttonStyles, paperStyles } from "../lib/styles";

export default function Component() {
  const [count, setCount] = React.useState(0);

  return (
    <main className="container my-8 px-8 mx-auto">
      <article className={`${paperStyles} prose max-w-none`}>
        <h1>About</h1>
        <p>This is the about page.</p>
        <p className="test-style-home">[test-style-home]</p>
        <button className={buttonStyles.base} onClick={() => setCount((c) => c + 1)}>
          Client counter: {count}
        </button>
      </article>
    </main>
  );
}
