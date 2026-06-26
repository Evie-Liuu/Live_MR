FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
# Install the Alpine (musl) lightningcss native binary.
# package-lock.json is generated on Windows so npm ci only locks the
# win32 binary; we need the linux-x64-musl one for this Alpine image.
RUN npm install --no-save lightningcss-linux-x64-musl 2>/dev/null || true
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
