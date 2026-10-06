FROM node:20-alpine

WORKDIR /app

COPY package.json .
RUN npm install --production

COPY index.js .

# Passed by the publish workflow. /health reports it, so what runs can be
# compared against the repository rather than taken on trust.
ARG BUILD_COMMIT=unknown
ENV BUILD_COMMIT=$BUILD_COMMIT

EXPOSE 8080

CMD ["node", "index.js"]
