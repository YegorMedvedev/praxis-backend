FROM node:24-alpine
# Pinned: the Auth emulator is part of firebase-tools. The layer is cached by
# Docker, so only the first run pays for the install.
RUN npm install --global firebase-tools@15.34.1
WORKDIR /emulator
COPY firebase.json .
EXPOSE 9099
CMD ["firebase", "emulators:start", "--only", "auth", "--project", "demo-praxis-e2e"]
