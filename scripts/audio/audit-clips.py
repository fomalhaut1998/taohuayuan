"""Audit only the owned audio files; optional exact-name staging cleanup after pass."""
from pathlib import Path
import hashlib, json, subprocess, sys
PROJECT = Path(__file__).resolve().parents[2]
ROOT = PROJECT / 'public' / 'audio' / 'round3'
manifest = json.loads((PROJECT / 'src/data/audio-samples.json').read_text(encoding='utf-8'))
assert manifest['version'] == 1
allowed = {'voice-ack','voice-laugh','cluck','crow','frog','stag','bark','chirp','low','quack','river','leaves'}
counts = {}
seen = set()
bytes_total = 0
verified = []
FFMPEG = 'D:/Tools/ffmpeg/bin/ffmpeg.exe'
FFPROBE = 'D:/Tools/ffmpeg/bin/ffprobe.exe'
for clip in manifest['clips']:
 assert clip['id'] not in seen
 seen.add(clip['id'])
 assert clip['category'] in allowed
 for field in ['id','category','src','sourceUrl','license','licenseUrl','attribution','sha256','bytes']:
  assert field in clip
 assert clip['src'] == '/audio/round3/' + clip['id'] + '.mp3'
 target = ROOT / (clip['id'] + '.mp3')
 assert target.resolve().parent == ROOT
 data = target.read_bytes()
 assert len(data) == clip['bytes']
 assert hashlib.sha256(data).hexdigest() == clip['sha256']
 assert 0 < clip['duration'] < 8
 assert 'trimStart' not in clip and 'trimEnd' not in clip
 info = json.loads(subprocess.run([FFPROBE,'-v','error','-show_entries','format=duration:stream=codec_name,sample_rate,channels','-of','json',str(target)],check=True,capture_output=True).stdout)
 stream = info['streams'][0]
 assert stream['codec_name'] == 'mp3' and stream['sample_rate'] == '44100' and stream['channels'] == 1
 assert abs(float(info['format']['duration'])-clip['duration']) < 0.05
 pcm = subprocess.run([FFMPEG,'-v','error','-i',str(target),'-f','s16le','-'],check=True,capture_output=True).stdout
 assert len(pcm) > 1000 and any(pcm)
 bytes_total += len(data)
 counts[clip['category']] = counts.get(clip['category'],0) + 1
 verified.append({'id':clip['id'],'bytes':len(data),'sha256':clip['sha256'],'duration':clip['duration'],'decodeExit':0})
assert bytes_total <= 12*1024*1024
for category in ['voice-ack','voice-laugh','cluck','crow','frog','stag','bark','chirp','low','quack']:
 assert counts.get(category,0) >= 2
original_keys = ['ack-168132','hmm-165011','laugh-231495','chuckles-463814','hen-0976','hen-0978','rooster-0283','rooster-0704','frog-0819','sika-3616','dog-0288','dog-0612','cow-2382','cow-2383','duck-0276','sparrows-1068']
staging = ROOT / 'licenses' / '.downloads'
original_digests = []
for key in original_keys:
 path = staging / (key + '.mp3')
 if path.is_file():
  data = path.read_bytes()
  original_digests.append({'sourceKey':key,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
if '--cleanup' in sys.argv:
 for key in original_keys:
  path = staging / (key + '.mp3')
  assert path.resolve().parent == staging.resolve()
  if path.is_file(): path.unlink()
 if staging.is_dir(): staging.rmdir()
print(json.dumps({'verdict':'pass','clips':len(verified),'totalBytes':bytes_total,'categories':counts,'verified':verified,'originalDigests':original_digests,'stagingRemoved':not staging.exists(),'audioTreeBytes':sum(p.stat().st_size for p in ROOT.rglob('*') if p.is_file())}))
