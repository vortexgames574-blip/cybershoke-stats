import sys
import json
import os
from awpy import Demo

def parse_demo(demo_path, output_path):
    print(f"[*] Начинаем парсинг демки: {os.path.basename(demo_path)}")
    
    if not os.path.exists(demo_path):
        print(f"[!] Ошибка: Файл {demo_path} не найден.")
        return

    try:
        demo = Demo(demo_path)
        # В awpy 2.x вместо parse() используется load()
        demo.load("kills", "damages", "shots")
        
        if demo.stats is None or len(demo.stats) == 0:
            print("[!] Не удалось извлечь статистику.")
            return

        players_stats = demo.stats.to_dicts()
        
        map_name = "unknown"
        try:
            if demo.header and "map_name" in demo.header:
                map_name = demo.header["map_name"]
        except Exception:
            pass

        clean_stats = []
        for p in players_stats:
            # ЖЕСТКО ПРИВОДИМ STEAMID К ЦЕЛОМУ ЧИСЛУ (СТРОКЕ)
            steamid = p.get("steamid")
            if steamid is not None:
                try:
                    steamid = str(int(steamid)) if isinstance(steamid, float) else str(steamid)
                except:
                    steamid = str(steamid)
            else:
                steamid = str(p.get("name", "unknown"))

            clean_stats.append({
                "map_name": map_name,
                "steamid": steamid,
                "name": p.get("name"),
                "team": p.get("team_number"),
                "kills": p.get("kills", 0),
                "deaths": p.get("deaths", 0),
                "assists": p.get("assists", 0),
                "adr": round(p.get("adr", 0.0), 2) if p.get("adr") is not None else None,
                "kast": round(p.get("kast", 0.0), 2) if p.get("kast") is not None else None,
                "rating": round(p.get("rating", 0.0), 2) if p.get("rating") is not None else None,
                "hs_percent": round(p.get("headshot_percentage", 0.0), 2) if p.get("headshot_percentage") is not None else None,
            })

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(clean_stats, f, ensure_ascii=False, indent=2)
            
        print(f"[+] Успех! Данные сохранены в {output_path}")
        
    except Exception as e:
        print(f"[!] Критическая ошибка при парсинге: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Использование: python parse_demo.py <путь_к_демке> <путь_к_JSON>")
        sys.exit(1)
    
    parse_demo(sys.argv[1], sys.argv[2])