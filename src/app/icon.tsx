import { ImageResponse } from "next/og";

export const size = {
  width: 32,
  height: 32,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "radial-gradient(circle at 30% 20%, #1e3a8a, #020617)",
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 22 22"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="4" cy="4" r="2.3" fill="#bfdbfe" />
          <circle cx="18" cy="6" r="2.3" fill="#bfdbfe" />
          <circle cx="7" cy="18" r="2.3" fill="#bfdbfe" />
          <circle cx="16" cy="16" r="2.3" fill="#bfdbfe" />

          <line
            x1="4"
            y1="4"
            x2="18"
            y2="6"
            stroke="#60a5fa"
            strokeWidth="1.4"
          />
          <line
            x1="4"
            y1="4"
            x2="7"
            y2="18"
            stroke="#60a5fa"
            strokeWidth="1.4"
          />
          <line
            x1="7"
            y1="18"
            x2="16"
            y2="16"
            stroke="#60a5fa"
            strokeWidth="1.4"
          />
          <line
            x1="18"
            y1="6"
            x2="16"
            y2="16"
            stroke="#60a5fa"
            strokeWidth="1.4"
          />
        </svg>
      </div>
    ),
    {
      ...size,
    }
  );
}


