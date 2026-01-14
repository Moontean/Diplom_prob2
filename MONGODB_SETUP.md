# MongoDB Setup Instructions

## Установка MongoDB Community

### Windows:
1. Скачайте MongoDB Community Server с https://www.mongodb.com/try/download/community
2. Установите MongoDB, следуя инструкциям установщика
3. Добавьте MongoDB в PATH (обычно C:\Program Files\MongoDB\Server\7.0\bin)

### Запуск MongoDB:
```powershell
# Создайте папку для данных
mkdir C:\data\db

# Запустите MongoDB
mongod --dbpath C:\data\db
```

### Альтернативно - MongoDB в Docker:
```powershell
# Запуск MongoDB в контейнере
docker run -d -p 27017:27017 --name cv-builder-mongo mongo:latest

# Остановка
docker stop cv-builder-mongo

# Запуск существующего контейнера
docker start cv-builder-mongo
```

## Подключение к базе данных

По умолчанию приложение попытается подключиться к:
- `mongodb://localhost:27017/cv_builder`

Если MongoDB недоступна, приложение автоматически переключится в режим работы в памяти.

## Проверка подключения

Вы можете проверить статус MongoDB:
```powershell
# Через mongo shell (если установлен)
mongo --eval "db.runCommand({connectionStatus: 1})"

# Или через MongoDB Compass (GUI клиент)
```