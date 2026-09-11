import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "ONDC Logistics Buyer App Platform (BAP) API",
      version: "1.0.0",
      description:
        "ONDC Logistics App Platform (LBNP/BAP) — app-facing endpoints for /search, /init, /confirm, /update, /status, /track, " +
        "plus the ONDC callback endpoints (/on_search, /on_init, /on_confirm, /on_update, /on_status, /on_track) the LSP calls back into. " +
        "App-facing endpoints take minimal business-level request bodies; the backend builds, signs, and sends the " +
        "full ONDC wire payload.",
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Local development",
      },
    ],
    tags: [
      {
        name: "Search",
        description: "POST /logistics/search, its polling/SSE endpoints, and the /on_search callback",
      },
      {
        name: "Init",
        description: "POST /logistics/init and the /on_init callback",
      },
      {
        name: "Confirm",
        description: "POST /logistics/confirm and the /on_confirm callback",
      },
      {
        name: "Update",
        description: "POST /logistics/update and the /on_update callback",
      },
      {
        name: "Status",
        description:
          "POST /logistics/status, its poll/SSE endpoints, and the /on_status callback",
      },
      {
        name: "Track",
        description:
          "POST /logistics/track, its poll endpoint, and the /on_track callback " +
          "(events also ride the /status SSE stream, event type order_tracking)",
      },
    ],
  },
  apis: ["./src/controllers/*.ts", "./src/routes/*.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
