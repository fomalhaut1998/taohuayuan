"""Create short natural excerpts. No synthesis, pitch/time changes, or splicing.
Run after acquire-recordings.py, from project root. Metadata goes to stdout.
"""
from pathlib import Path
import hashlib, json, subprocess
PROJECT = Path(__file__).resolve().parents[2]
ROOT = PROJECT / 'public' / 'audio' / 'round3'
STAGING = ROOT / 'licenses' / '.downloads'
FFMPEG = 'D:/Tools/ffmpeg/bin/ffmpeg.exe'
FFPROBE = 'D:/Tools/ffmpeg/bin/ffprobe.exe'
# id, category, source key, source start/end seconds, fixed gain dB
CLIPS = [
 ('voice-ack-01','voice-ack','ack-168132',3.85,4.55,12),
 ('voice-ack-02','voice-ack','ack-168132',9.90,10.60,12),
 ('voice-laugh-01','voice-laugh','laugh-231495',0.12,1.23,0),
 ('voice-laugh-02','voice-laugh','chuckles-463814',0.14,1.02,0),
 ('voice-laugh-03','voice-laugh','chuckles-463814',2.30,3.18,0),
 ('cluck-01','cluck','hen-0976',0.05,2.40,0),
 ('cluck-02','cluck','hen-0978',0.05,2.20,0),
 ('crow-01','crow','rooster-0283',0.04,2.28,-3.5),
 ('crow-02','crow','rooster-0704',4.18,6.36,0),
 ('frog-01','frog','frog-0819',2.20,3.60,2.5),
 ('frog-02','frog','frog-0819',12.80,14.56,2.0),
 ('stag-01','stag','sika-3616',39.38,41.62,6.5),
 ('stag-02','stag','sika-3616',42.24,44.68,6.5),
 ('bark-01','bark','dog-0288',0.20,2.20,0),
 ('bark-02','bark','dog-0612',0.10,0.90,0),
 ('chirp-01','chirp','sparrows-1068',0.15,2.60,0),
 ('chirp-02','chirp','sparrows-1068',4.00,6.50,0),
 ('low-01','low','cow-2382',0.20,2.55,0),
 ('low-02','low','cow-2383',0.20,2.82,0),
 ('quack-01','quack','duck-0276',0.30,1.80,0),
 ('quack-02','quack','duck-0276',2.30,3.25,0),
]
for clip_id, category, source, start, end, gain in CLIPS:
 original = STAGING / (source + '.mp3')
 target = ROOT / (clip_id + '.mp3')
 if not original.is_file() and target.is_file():
  continue
 duration = round(end - start, 6)
 filters = f'volume={gain}dB,afade=t=in:d=0.008,afade=t=out:st={duration-0.035:.6f}:d=0.035'
 subprocess.run([FFMPEG,'-hide_banner','-loglevel','error','-y','-ss',str(start),'-i',str(original),'-t',str(duration),'-ac','1','-ar','44100','-af',filters,'-codec:a','libmp3lame','-q:a','4','-map_metadata','-1',str(target)], check=True)
 info = json.loads(subprocess.run([FFPROBE,'-v','error','-show_entries','format=duration:stream=codec_name,sample_rate,channels','-of','json',str(target)],check=True,capture_output=True).stdout)
 subprocess.run([FFMPEG,'-v','error','-i',str(target),'-f','null','-'],check=True,capture_output=True)
 data = target.read_bytes()
 original_data = original.read_bytes()
 print(json.dumps({'id':clip_id,'category':category,'src':'/audio/round3/'+target.name,'duration':round(duration,6),'encodedDuration':float(info['format']['duration']),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'sourceKey':source,'sourceSha256':hashlib.sha256(original_data).hexdigest(),'sourceBytes':len(original_data),'sourceTrimStart':start,'sourceTrimEnd':end,'gainDb':gain,'format':info['streams'][0]}),flush=True)
