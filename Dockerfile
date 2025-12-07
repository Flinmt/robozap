FROM node:18-alpine

# Crie o diretório de trabalho
WORKDIR /usr/src/app

# Copie os arquivos de dependência
COPY package*.json ./

# Instale as dependências
RUN npm install

# Copie o restante do código fonte
COPY . .

# Expõe a porta que o servidor web usa (padrão 3000)
EXPOSE 3000

# Comando para iniciar a aplicação
CMD [ "npm", "start" ]
