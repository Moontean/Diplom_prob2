const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Настройки подключения (обновленные)
    const options = {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    };

    // URL подключения к MongoDB (можно настроить через переменные окружения)
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cv_builder';
    
    const conn = await mongoose.connect(mongoURI, options);
    
    console.log(`MongoDB подключена: ${conn.connection.host}`);
    
    // Обработчики событий подключения
    mongoose.connection.on('error', (err) => {
      console.error('Ошибка MongoDB:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB отключена');
    });
    
    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB переподключена');
    });
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('MongoDB соединение закрыто через app termination');
      process.exit(0);
    });
    
    return conn;
  } catch (error) {
    console.error('Ошибка подключения к MongoDB:', error.message);
    
    // Fallback: работа без базы данных (для разработки)
    console.log('Работа в режиме без базы данных (in-memory)');
    return null;
  }
};

module.exports = connectDB;