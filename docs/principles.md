# Design principles

These are the rules every other decision answers to.

1. **Clear, honest semantics.** Every construct means one thing, and it means it out loud. Nothing happens behind your back: no values that are secretly something else, no operations that quietly throw information away, no failures that dress up as success. If something is going to go wrong, you get to see it go wrong.

2. **Remove the trap, don't label it.** Most languages are full of sharp edges and then warn you about them in the documentation. We take the opposite view: a dangerous thing is either made impossible or made impossible to ignore. A footnote in a manual nobody reads is not a safety feature.

3. **One obvious way.** When consistency and convenience disagree, consistency usually wins. There's generally one way to do each thing, so a beginner isn't asked to memorize five spellings of the same idea before they've written a single line. A handful of shortcuts earn their place; everything else is left out on purpose.

4. **A stepping stone, not a destination.** Ascent is a place to begin, not a place to stay, so it's built for whatever comes after it. The aim is to transfer to many languages rather than to imitate one. Familiar surface habits build muscle memory; clean underlying behavior builds correct instincts, and when the two disagree, behavior wins.

5. **Errors are part of the lesson.** When something breaks, the message isn't an afterthought written for a seasoned engineer. It's written to be read by a beginner, in plain language, and it points at the actual thing they wrote. For a learner, the moment something breaks is the moment they learn, so the message has to teach.

6. **Power is opt-in, and late.** The advanced, powerful features don't greet you at the door. They arrive later, as their own chapter, once there's a reason to care about them. Nobody should have to pay a complexity tax on day one for capabilities they won't need for weeks.

## A note on false friends

Principle 4 is worth a little more unpacking, because not every difference between Ascent and the languages you'll meet later is worth worrying about.

The ones that matter are the *false friends*: something that looks familiar from another language but quietly does something else. That silent mismatch is exactly the kind of bug that teaches a beginner the wrong lesson, so we design it out.

The harmless differences are the opposite. They're the things a future language simply won't have, and there they show up as an honest error rather than a silent surprise. The learner is told, and adapts. So every difference that remains in Ascent is deliberate: a small graduation lesson, left in on purpose.
