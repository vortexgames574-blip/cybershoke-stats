import sys
import json
import os
from awpy import Demo

def main():
    # Проверка, что переданы аргументы (путь к демке и путь к выходному json)
    if len(sys.argv) < 3:
        print("Ошибка: Не переданы аргументы.")
        print("Использование: python parse_demo.py <путь_к_dem_файлу> <путь_к_json>")
        sys.exit(1)

    dem_path = sys.argv[1]
    out_path = sys.argv[2]

    if not os.path.exists(dem_path):
        print(f"Ошибка: Файл демки не найден по пути {dem_path}")
        sys.exit(1)

    try:
        print(f"Запуск парсинга awpy для: {os.path.basename(dem_path)}")
        
        # Инициализация объекта Demo (файл проверяется и читается автоматически)
        demo = Demo(dem_path)

        # Загружаем необходимые наборы данных
        # В новых версиях awpy данные доступны как свойства (demo.kills, demo.stats и т.д.)
        # Метод load() позволяет явно запросить загрузку нужных таблиц
        demo.load("kills", "stats")

        # Получаем название карты из заголовка
        map_name = demo.header.get("map_name", "unknown_map")

        players_list = []

        # Проверяем, что таблица статистики игроков загрузилась
        if hasattr(demo, "stats") and demo.stats is not None:
            # Преобразуем Polars DataFrame в список словарей, который ожидает ваш JS-скрипт
            # Используем .to_dicts() для получения списка словарей
            players_list = demo.stats.to_dicts()
            
            # Добавляем имя карты к каждому игроку
            for player in players_list:
                player["map_name"] = map_name
                # Переименовываем ключ 'steamid' в 'steamid', если он отличается (в новых версиях обычно 'steamid')
                # На всякий случай проверяем наличие нужных полей
                if "steamid" not in player and "steam_id" in player:
                    player["steamid"] = player["steam_id"]
        else:
            print("Предупреждение: не удалось загрузить статистику игроков (demo.stats пуст).")

        # Сохраняем результат в файл
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(players_list, f, ensure_ascii=False, indent=2)

        print(f"Успешно! Данные сохранены в {out_path}")

    except Exception as e:
        print(f"Критическая ошибка при парсинге awpy: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()