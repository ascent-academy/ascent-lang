# Ascent: The Teaching Language

> *Ascent is a programming language built to teach programming to complete beginners. The goal is to do it clearly, gently, and from the ground up.*

So, let's address the big question already forming in your mind: *do we really need a hundredth programming language?*

Fair. And the straight answer is that Ascent isn't only a language. It's also an environment. That matters, because beginners get tripped up by two very different things, and most setups only ever fix one of them, if any.

**The first is the environment itself.** Long before a newcomer writes anything interesting, they're wrestling with the terminal, the file system, an IDE bristling with buttons, even their own keyboard. They end up hunting for a curly brace they've never had a reason to type before. None of this is programming. It's just friction: exhausting and discouraging for someone who only wants to see a program run, ideally one that does something interesting and UI-based, not yet another number-guessing game in a terminal.

Ascent starts you somewhere kinder: a web page with a text box and a Run button. You write a few lines, click Run, and the result appears right away. That's the whole ceremony.

**The second is the language.** Most languages were never designed to be learned. They were designed to be practical and fast for professionals, and they've collected decades of legacy baggage along the way. I dare any teacher to explain the difference between `null` and `undefined` in JavaScript to a room of first-timers without watching every face go blank.

Ascent's language is shaped by the opposite priority: every concept should be explainable to someone who has never seen code before. The rest of this document is about how and why we made those choices.

Read the design principles: [docs/principles.md](docs/principles.md)

## The Taste of Ascent

```ascent
# No HTML, no input library. Ascent gathers the inputs, then runs your code.
args (name: String, score: Int);

type Grade = Honors | Pass | Fail;

fix grade =
    if (score >= 90) { Honors }
    else if (score >= 50) { Pass }
    else { Fail };

fix note = match (grade) {
    Honors -> "Outstanding work!";
    Pass   -> "Nicely done!";
    Fail   -> "Keep going, you'll get there!";
};

# The program returns the result of the last expression
"Hi ${name}, you scored ${score}. ${note}"
```
