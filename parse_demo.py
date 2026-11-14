import sys
import json
import os
from awpy import Demo

def parse_demo(demo_path, output_path):
    print(f"    [awpy] Парсим демку: {os.path.basename(demo_path)}")
    try:
        demo = Demo(demo_path)
        demo.parse()
        
        # Получаем статистику
        stats_df = demo.stats
        
        if stats_df is None or len(stats_df) == 0:
            print("    [awpy] Демка пуста или не удалось извлечь статистику.")
            return

        players_stats = stats_df.to_dicts()
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(players_stats, f, ensure_ascii=False, indent=2)
            
        print(f"    [awpy] Успех! Игроков в демке: {len(players_stats)}")
    except Exception as e:
        print(f"    [awpy] Ошибка парсинга: {e}")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Использование: python parse_demo.py <путь_к_демке> <путь_к_JSON>")
        sys.exit(1)
    
    parse_demo(sys.argv[1], sys.argv[2])
