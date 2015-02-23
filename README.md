lotsawa
=======

A port of the Marpa parsing algorithm to javascript.

The Marpa algorithm is an evolution of Jay Earley's 1972 parsing algorithm,
deemed impractical in its time due to O(n^3) worst-case complexity and poor
constant factor.

Aycock and Horspool's 2002 changes, and Joop Leo's 1991 bug fixes to the
algorithm reduce most common cases to O(n) time, and Jeffrey Kegler's careful
implementation has reduced the constant factor to quite acceptable on modern
CPU.

I've attempted to take the core of the Marpa algorithm and encode it as
Javascript as best I can.

Notes for how to use the parser are forthcoming, and I have interest in
explaining the algorithm and the efficient implementation more clearly. With
luck and time, I will be able to illuminate some of this.
