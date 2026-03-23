# Инструкция: Добавление плейсхолдеров в DOCX шаблоны

## Плейсхолдеры для подстановки данных

Откройте DOCX файлы в Microsoft Word и замените статичный текст на плейсхолдеры:

### Личная информация
```
{{firstName}} {{lastName}}
{{email}}
{{phone}}
{{address}}
{{city}}, {{postalCode}}
{{jobPosition}}
{{website}}
{{linkedin}}
{{birthdate}}
```

### Профессиональная цель (Career Objective)
```
{{careerObjective}}
```

### Опыт работы (Work History)
Для каждой записи о работе:
```
{{position}} - {{company}}
{{startDate}} - {{endDate}}
{{jobDescription}}
```

### Образование (Education)
```
{{degree}} - {{school}}
{{startYear}} - {{endYear}}
{{fieldOfStudy}}
```

### Навыки (Skills)
```
{{skill1}}, {{skill2}}, {{skill3}}...
```
или
```
{{skillName}} - {{skillLevel}}
```

### Языки (Languages)
```
{{language}} - {{level}}
```

### Дополнительные секции
```
{{profile}}
{{projects}}
{{certificates}}
{{courses}}
{{achievements}}
```

## Примеры замены

### До:
```
CHERYL MARTIN
example@example.com
555-555-5555
Cranberry Township, PA 16066
```

### После:
```
{{firstName}} {{lastName}}
{{email}}
{{phone}}
{{city}}, {{postalCode}}
```

## Как это работает

1. Пользователь выбирает шаблон на странице template-selection.html
2. Заходит в cv-builder и заполняет форму
3. При скачивании DOCX:
   - Сервер читает выбранный DOCX файл
   - Заменяет все плейсхолдеры на данные пользователя
   - Отдаёт готовый файл

## Следующие шаги

После добавления плейсхолдеров в DOCX файлы, нужно обновить серверный код:
- `/routes/api/cv.js` - метод `download-docx`
- Использовать библиотеку `docxtemplater` для замены плейсхолдеров
