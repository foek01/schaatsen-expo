FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public ./public
COPY data ./data
ENV PORT=8080
ENV ADMIN_PASSWORD=schaatsadmin
EXPOSE 8080
CMD ["node", "server.js"]
