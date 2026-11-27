"""Compare descriptions of the recording across time with the installed CLAP2 model."""
from statistics import fmean


# Score each facet independently. These are comparison candidates, not a closed taxonomy.
VOCABULARY = {
    "genre": (
        "A {} track.",
        "Latin house|deep house|funky house|tropical house|soulful house|Afro house|"
        "Chicago house|French house|acid house|progressive house|tech house|microhouse|"
        "garage house|UK garage|disco|nu disco|funk|soul|neo-soul|contemporary R&B|"
        "gospel|blues|jazz fusion|bebop|smooth jazz|acid jazz|swing jazz|Latin jazz|"
        "hip-hop|boom bap|trap|drill|grime|trip-hop|breakbeat|drum and bass|liquid drum and bass|"
        "jungle|dubstep|IDM|ambient electronic|downtempo|chillout|synth-pop|dance-pop|"
        "indie pop|art pop|K-pop|J-pop|Europop|pop rock|indie rock|alternative rock|"
        "classic rock|psychedelic rock|punk rock|post-punk|shoegaze|grunge|"
        "hard rock|heavy metal|death metal|folk rock|acoustic folk|country|bluegrass|"
        "Americana|flamenco|tango|salsa|mambo|merengue|bachata|cumbia|reggaeton|"
        "Latin pop|bossa nova|samba|MPB|Brazilian funk|forró|reggae|dub|dancehall|"
        "soca|Afrobeat|Afrobeats|Afropop|amapiano|highlife|soukous|rai|Arabic pop|"
        "Bollywood|bhangra|Hindustani classical|Carnatic classical|traditional Chinese|"
        "traditional Japanese|Celtic folk|chamber music|baroque classical|"
        "romantic classical|orchestral film score|minimalist classical|choral|"
        "Detroit techno|minimal techno|dub techno|hard techno|trance|"
        "progressive trance|electro|hardstyle|industrial electronic|electroacoustic|"
        "experimental music|noise music|ambient drone|spoken word",
    ),
    "mood": (
        "Music with a {} mood.",
        "relaxed|dreamy|intimate|tender|romantic|melancholic|nostalgic|hopeful|"
        "playful|joyful|euphoric|mysterious|tense|ominous|aggressive|triumphant|spiritual",
    ),
    "energy": (
        "Music with {}.",
        "low and steady energy|gentle momentum|a steady dancefloor drive|high intensity|"
        "a gradual rise in energy|strong contrasts between quiet and loud sections",
    ),
    "groove": (
        "Music with {}.",
        "a steady four-on-the-floor kick|a marching straight rhythm|swung subdivisions|"
        "a syncopated bass line|a Latin-influenced syncopated melodic hook|"
        "offbeat guitar or keyboard accents|layered hand percussion|a backbeat|"
        "a broken-beat groove|a sparse half-time pulse|free unmetered phrasing|polyrhythmic percussion",
    ),
    "instruments": (
        "Music featuring {}.",
        "a prominent lead vocal|layered vocal harmonies|rapped vocals|vocal chops|"
        "acoustic piano|electric piano|acoustic guitar|clean electric guitar|"
        "distorted electric guitar|bowed strings|brass|woodwinds|acoustic bass|"
        "electric bass guitar|synth bass|synth pads|lead synthesizer|a live drum kit|"
        "electronic drum machine sounds|congas or bongos|shakers|mallet percussion",
    ),
    "production": (
        "Music with {}.",
        "a warm rounded tone|a bright crisp tone|a dark filtered tone|"
        "an airy spacious texture|a dry close sound|a dense layered arrangement|"
        "a sparse exposed arrangement|an audible delay or echo|a long reverb tail|"
        "grainy saturated texture|pumping dynamics|a looped motif|"
        "sample-like chopped textures|a distinctly acoustic recording texture",
    ),
}


def windows(frames, rate):
    width = 8 * rate
    last_start = max(0, frames - width)
    count = min(32, (frames + width - 1) // width)
    return [(start, min(frames, start + width)) for start in (
        [0] if count <= 1 else [round(last_start * i / (count - 1)) for i in range(count)]
    )]


def describe(audio, rate, model, clap2, update):
    inventory = [
        {"facet": facet, "label": label, "prompt": template.format(label)}
        for facet, (template, labels) in VOCABULARY.items()
        for label in dict.fromkeys(labels.split("|"))
    ]
    prompts = [item["prompt"] for item in inventory]
    intervals = windows(len(audio), rate)
    excerpts = []
    for index, (start, end) in enumerate(intervals):
        update(index + 1, len(intervals))
        samples = audio[start:end]
        if abs(samples).max() < 0.001:
            continue
        scores = clap2(samples, model, 2, prompts, False)["prompt_similarity"]
        by_prompt = {item["prompt"]: item["cosine"] for item in scores}
        excerpts.append({
            "start_s": round(start / rate, 3), "end_s": round(end / rate, 3),
            "scores": [round(by_prompt[prompt], 6) for prompt in prompts],
        })

    profile = {
        "status": "candidate" if excerpts else "insufficient_signal",
        "method": "LAION CLAP2 across the track", "model": model.name,
        "duration_s": round(len(audio) / rate, 3), "window_count": len(intervals),
        "inventory": inventory, "excerpts": excerpts,
        "limitations": [
            "Scores rank descriptions within each facet and are not probabilities.",
            "Mood, instruments and production details are candidates. The recording alone does not establish how it was made.",
        ],
    }
    if not excerpts:
        return profile

    facets = {}
    for facet in VOCABULARY:
        ranked = []
        for index, item in enumerate(inventory):
            if item["facet"] != facet:
                continue
            peak = max(excerpts, key=lambda clip: clip["scores"][index])
            ranked.append({
                "label": item["label"], "prompt": item["prompt"],
                "mean_cosine": round(fmean(clip["scores"][index] for clip in excerpts), 6),
                "peak_start_s": peak["start_s"], "peak_end_s": peak["end_s"],
            })
        facets[facet] = sorted(ranked, key=lambda item: item["mean_cosine"], reverse=True)
    profile["facets"] = facets
    return profile
