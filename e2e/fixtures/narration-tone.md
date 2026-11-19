# Narration boundary fixture

Synthetic 440 Hz tone (200 ms), with 100 ms silence before and after it.
No speech or user data. Generated with ffmpeg for browser decoding/concatenation
regression coverage; it checks that existing silence is counted toward the
350 ms sentence boundary instead of adding the full interval again.

Command:
    ffmpeg -f lavfi -i sine=frequency=440:sample_rate=44100:duration=0.2 -af adelay=100,apad=pad_dur=0.1 -codec:a libmp3lame -b:a 128k -reservoir 0 -write_xing 0 -map_metadata -1 narration-tone.mp3
