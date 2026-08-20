import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "ONDC Logistics Buyer App Platform (BAP) API",
      version: "1.0.0",
      description:
        "ONDC Logistics App Platform — supports /issue, /on_issue, /issue_status, /on_issue_status and all standard ONDC logistics flows.",
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Local development",
      },
    ],
    tags: [
      {
        name: "Issue",
        description:
          "IGM Issue management — /issue, /issue_status, /on_issue, /on_issue_status",
      },
    ],
  },
  apis: ["./src/controllers/*.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
