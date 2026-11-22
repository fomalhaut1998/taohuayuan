"""Round 3 reproducible download/decoder probe. Binary IO only; metadata is printed.
Run from project root: python public/audio/round3/licenses/acquire-recordings.py
Sources and licenses are independently documented in the accompanying notices.
"""
from pathlib import Path
import concurrent.futures, hashlib, json, math, struct, subprocess
PROJECT = Path(__file__).resolve().parents[2]
ROOT = PROJECT / 'public' / 'audio' / 'round3'
STAGING = ROOT / 'licenses' / '.downloads'
STAGING.mkdir(exist_ok=True)
FFMPEG = 'D:/Tools/ffmpeg/bin/ffmpeg.exe'
FFPROBE = 'D:/Tools/ffmpeg/bin/ffprobe.exe'
SOURCES = {
 'ack-168132': 'https://cdn.freesound.org/previews/168/168132_2478427-hq.mp3',
 'hmm-165011': 'https://cdn.freesound.org/previews/165/165011_2992529-hq.mp3',
 'laugh-231495': 'https://cdn.freesound.org/previews/231/231495_2476414-hq.mp3',
 'chuckles-463814': 'https://cdn.freesound.org/previews/463/463814_8472935-hq.mp3',
 'hen-0976': 'https://bigsoundbank.com/UPLOAD/mp3/0976.mp3',
 'hen-0978': 'https://bigsoundbank.com/UPLOAD/mp3/0978.mp3',
 'rooster-0283': 'https://bigsoundbank.com/UPLOAD/mp3/0283.mp3',
 'rooster-0704': 'https://bigsoundbank.com/UPLOAD/mp3/0704.mp3',
 'frog-0819': 'https://bigsoundbank.com/UPLOAD/mp3/0819.mp3',
 'sika-3616': 'https://bigsoundbank.com/UPLOAD/mp3/3616.mp3',
 'dog-0288': 'https://bigsoundbank.com/UPLOAD/mp3/0288.mp3',
 'dog-0612': 'https://bigsoundbank.com/UPLOAD/mp3/0612.mp3',
 'cow-2382': 'https://bigsoundbank.com/UPLOAD/mp3/2382.mp3',
 'cow-2383': 'https://bigsoundbank.com/UPLOAD/mp3/2383.mp3',
 'duck-0276': 'https://bigsoundbank.com/UPLOAD/mp3/0276.mp3',
 'sparrows-1068': 'https://bigsoundbank.com/UPLOAD/mp3/1068.mp3',
}
def probe(item):
 key, url = item
 target = STAGING / (key + '.mp3')
 if not target.exists():
  subprocess.run(['curl.exe', '--fail', '--location', '--max-time', '90', '--retry', '1', '--output', str(target), url], check=True, capture_output=True)
 data = target.read_bytes()
 info = json.loads(subprocess.run([FFPROBE, '-v', 'error', '-show_entries', 'format=duration:stream=codec_name,sample_rate,channels', '-of', 'json', str(target)], check=True,capture_output=True).stdout)
 decoded = subprocess.run([FFMPEG, '-v', 'error', '-i', str(target), '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], check=True,capture_output=True).stdout
 samples = struct.unpack('<' + 'h'*(len(decoded)//2), decoded)
 windows = [samples[i:i+800] for i in range(0,len(samples),800)]
 rms = [round(20*math.log10(max(1, math.sqrt(sum(x*x for x in w)/len(w)))/32768),1) for w in windows if w]
 out = {'source':key,'downloadUrl':url,'sourceSha256':hashlib.sha256(data).hexdigest(),'sourceBytes':len(data),'probe':info,'rms100ms':rms if key in ('ack-168132','hmm-165011','laugh-231495','chuckles-463814') else rms[:60]}
 return out
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 for result in pool.map(probe, SOURCES.items()):
  print(json.dumps(result), flush=True)
