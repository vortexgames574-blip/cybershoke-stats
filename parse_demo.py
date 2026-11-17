import sys
import json
import os
from awpy import Demo

def main():
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
        
        demo = Demo(dem_path)
        demo.load("kills", "stats")

        map_name = demo.header.get("map_name", "unknown_map")
        players_list = []

        if hasattr(demo, "stats") and demo.stats is not None:
            players_list = demo.stats.to_dicts()
            
            for player in players_list:
                player["map_name"] = map_name
                
                # КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Переводим ID в строку, чтобы JS не терял точность
                if "steamid" in player and player["steamid"] is not None:
                    player["steamid"] = str(player["steamid"])
                if "steam_id" in player and player["steam_id"] is not None:
                    player["steam_id"] = str(player["steam_id"])
                    if "steamid" not in player:
                        player["steamid"] = player["steam_id"]
        else:
            print("Предупреждение: не удалось загрузить статистику игроков (demo.stats пуст).")

        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(players_list, f, ensure_ascii=False, indent=2)

        print(f"Успешно! Данные сохранены в {out_path}")

    except Exception as e:
        print(f"Критическая ошибка при парсинге awpy: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()