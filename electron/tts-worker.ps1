$ErrorActionPreference = 'Stop'
# Input is newline-delimited JSON on stdin, never interpolated into executable code.
# A C# event handler keeps cancellation/completion independent of the stdin loop.
try {
    Add-Type -AssemblyName System.Speech
    Add-Type -AssemblyName System.Web.Extensions
    $source = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Speech.Synthesis;
using System.Text;
using System.Web.Script.Serialization;

public static class StreamerAssistSpeech {
    static readonly object gate = new object();
    static readonly JavaScriptSerializer json = new JavaScriptSerializer();
    static readonly Dictionary<Prompt, int> prompts = new Dictionary<Prompt, int>();
    static void Write(object value) {
        lock (gate) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); }
    }
    public static void Run() {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        using (var synth = new SpeechSynthesizer()) {
            var voices = new List<object>();
            foreach (var installed in synth.GetInstalledVoices()) {
                if (!installed.Enabled) continue;
                voices.Add(new { name = installed.VoiceInfo.Name, lang = installed.VoiceInfo.Culture.Name });
            }
            foreach (var installed in synth.GetInstalledVoices())
                if (installed.Enabled && installed.VoiceInfo.Culture.Name == "ko-KR") { synth.SelectVoice(installed.VoiceInfo.Name); break; }
            var defaultVoice = synth.Voice.Name;
            synth.SetOutputToDefaultAudioDevice();
            synth.SpeakCompleted += (sender, e) => {
                int id;
                lock (gate) {
                    if (!prompts.TryGetValue(e.Prompt, out id)) return;
                    prompts.Remove(e.Prompt);
                }
                Write(new { @event = "done", id = id, error = e.Error != null });
            };
            Write(new { @event = "ready", voice = defaultVoice, voices = voices });
            string line;
            while ((line = Console.ReadLine()) != null) {
                try {
                    if (line.Length > 24000) throw new ArgumentException();
                    Dictionary<string, object> input;
                    lock (gate) { input = json.Deserialize<Dictionary<string, object>>(line); }
                    var action = Convert.ToString(input["action"]);
                    if (action == "cancel") { synth.SpeakAsyncCancelAll(); continue; }
                    if (action != "speak") throw new ArgumentException();
                    var text = Convert.ToString(input["text"]);
                    if (text.Length == 0 || text.Length > 500) throw new ArgumentException();
                    var voice = input.ContainsKey("voice") ? Convert.ToString(input["voice"]) : defaultVoice;
                    synth.SelectVoice(String.IsNullOrEmpty(voice) ? defaultVoice : voice);
                    var prompt = new Prompt(text, SynthesisTextFormat.Text);
                    lock (gate) { prompts[prompt] = Convert.ToInt32(input["id"]); }
                    synth.SpeakAsync(prompt);
                } catch { Write(new { @event = "error" }); }
            }
            synth.SpeakAsyncCancelAll();
        }
    }
}
'@
    Add-Type -TypeDefinition $source -ReferencedAssemblies System.Speech, System.Web.Extensions
    [StreamerAssistSpeech]::Run()
} catch {
    [Console]::WriteLine('{"event":"error"}')
    exit 1
}
