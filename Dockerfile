FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json* ./

RUN npm install --omit=dev && npm cache clean --force

COPY . .

RUN mkdir -p /app/data

VOLUME ["/app/data"]

EXPOSE 3000

CMD ["npm", "start"]
