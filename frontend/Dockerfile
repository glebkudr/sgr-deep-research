FROM node:20-alpine

WORKDIR /app

COPY package.json ./

RUN npm install

COPY . .

# Build-time env injection for Next.js public vars
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_JWT
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_JWT=${NEXT_PUBLIC_JWT}

# Server-side envs are passed at runtime by docker-compose (not baked here)

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]
