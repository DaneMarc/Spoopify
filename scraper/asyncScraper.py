import requests
import re
import csv
import time
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed
from multiprocessing import cpu_count

soup = BeautifulSoup(requests.get("http://everynoise.com/engenremap.html").text, "html.parser")
genres = soup.find_all("div", "genre scanme")

def parse(genre):
    cleaned = genre.strip().replace("»", "")
    print("Pulling genre " + cleaned)
    soup2 = BeautifulSoup(requests.get("http://everynoise.com/engenremap-" + re.sub("[:'+»&\s-]", '', genre) + ".html").text, "html.parser")
    allGenresRelated = soup2.find_all("div", id=re.compile("^mirroritem\d+"))
    oppGenres = []
    oppWeights = []
    oppLinks = []
    
    for oppGenre in allGenresRelated:
        oppWeights.append(int(oppGenre['style'].split()[-1].replace('%', '')))
        oppGenres.append(oppGenre.text.strip().replace("»", ""))
        oppLinks.append(oppGenre['preview_url'][30:])
    
    return [cleaned, oppGenres, oppWeights, oppLinks]

if __name__ == '__main__':
    # with ThreadPoolExecutor(max_workers=cpu_count()) as executor:
    with ThreadPoolExecutor(max_workers=3) as executor:
        with open("genres.csv", "w", newline="") as f:
            writer = csv.writer(f)
            start = time.time()
            futures = [ executor.submit(parse, genre.text) for genre in genres ]
            for result in as_completed(futures):
                writer.writerow(result.result())

        end = time.time()
        print("Time Taken: {:.6f}s".format(end-start))
