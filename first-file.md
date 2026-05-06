Apr 17 2026

**_ Task _**

- This project folder contains an old baseball general manager simulator game I build in 2010. It was regular HTML - CSS - some JS and JQuery front end, Java to run daemons and PHP backend, mySQL db, it also ran on Apache (MAMP) system.

- Review and evaluate the feesibility of implimenting this project again.
- Include a general code review
- Stack
- security (but this may just be better later)
- I am open to some agent coding or translating of code to more update langugaes and stack elements (technology)
- This would be web based
  ...

**_ Task _**
Yes. Please Conduct a comprehensive review of the Baseballczar 2.0 project at this point. I will note some UI from the old project are not yet implimented but we will work on it over time.

- Create a master file called BBZAR_MASTER_REVIEW.md place it in the project root. Reference the below sections to keep the markdown files readable and not too long.
- Include the date and time the file was written at the top of each file.
- If not planned create a section in BBZAR_MASTER_REVIEW.md explaing how the project is structured, how the games are simulated (this was a heavy server function and the reason game sim ran separately from the website. I also ran daemons for Training and Trades based on the 1 time in 24 hours and when the trade window date ended. In its current state the site feels very slow. In testing the old version simulated an entire season in a couple minutes but our current test season sim seems to go very slow, previously I could see game sim logs in its own terminal and could monitor for issues this now happens in silence.) For gaming this is probably pretty important since these are different processes.

- Create a separate markdown for each area of concern:
  Correctness & Logic
  Security
  Architecture & Design
  - Game Sim
    Data Integrity
    Error Handling
    Performance
    Readability & Maintainability
    Testing
    Improvement Plan

- Update the README.md with appropriate infomation

...
**_ Issue _**

- starting Pitchers are not being rotated through the season. This will require some tracking mechanics to call the correcting starting pitcher for the game.
- This is typically tracked ie; Game 1 uses starter SP1, Game 2 uses SP2.
- the Bullpen has 5 pitchers, typically one is designated as a "closer" with a specific CL position; The positions are RP1, RP2, RP3, RP4 and CL. The Sim logic would use the CL in the end of the game to "close" out the game.
- The Pitcher Roster needs to allow 10 pitchers, no more no less, the rest are reserve and the Rotation page should have 10 pitchers 5 starters and the 5 Relievers.

...
Arp 28 2026
Yes > we are migrating to a new engine all together > Path — Full migration to the new engine. C reason: This project is in dev stage so we are going full out. The new sim needs a stand alone sandbox for quickly iterating games to make sure it works correctly ie; the outcomes, physics and eventual graphics. I also want to see what you can do!

...

Apr 28, there was an issue where a home run the runner did not touch the bases, rather traveled around the pitchers mound .

...
looks a lot better. The ball is still disappearing mid flight to the outfield. I notice the batter disappears in some views. On another note this play: Contact: 112 mph, LA -15°, spray +44° (RF-line), 259 ft
Fielded by K. Zimmer (RF)
→ K. Foster: Single (off K. Zimmer, RF), it should

...

**_ Issue _**

- The runner on base situations are limited :
- No Runners, Runner at First, Runner at Second, Runner at 3rd
- Runners at First and Second, Runners at First and Third, Runners at First, Second and Third
- Runners at Second and Thrird

- Fielders should have logic to make descisions based on each runner condition.
- Fielders should know their responsibility when the ball is hit given each Runner Condition and Where the ball is hit.
- Fielders logic for these conditions are also based on the number of outs; ie 2 outs get the easy out. less than 2 outs is there a double play possible?
- Do we need to cut off the runner from scoring? This is a score based influence, if you are up by 5 runs with a hit to the outfield maybe the outfielder throws the ball to 2nd base to keep the runners from advancing rather than trying to get the runner at home, which would allow runners to advance on the long throw. There is also sacrific fly balls and infield fly rule.
- some are pure A happens do B, some should be "Can I make the throw in the moment?" which skill wise might be a roll.
- what is the best approach to using player intellegence (PI) to help players (runners and fielders) make these descisions. Should we work out the logic together?

- No runners - fielder focus on getting batter out.
- Runner at 1st base - fielder could try for double play > 2nd base throw to 1st. If there are 2 outs get the easy runner ie; first baseman fields the ball runs and tags first base - the lead runner is not priority.
- short stop fields the ball they could tag 2nd base or throw to the 2nd baseman on 2nd base. And vice versa for 2nd base.
- 3rd baseman also makes these decisions.
- Catcher makes this descision.
- Pitcher may need to run to 1st base if the first baseman fields the ball and goes to 2nd base for the double play.

**_ Context _**

- When the batter hits a ground ball to an infielder or generally into the infield a runner at first base must move towards 2nd base. This also applies with runners at 1st and 2nd (1st to 2nd and 2nd to 3rd), or 1st, 2nd and 3rd (bases loaded), if runners are at 1st and 3rd the runner at 1st base runner must move towards 2nd base, while the 3rd base runner can hold to wait for the play to develop, unless there are two outs then the 3rd base runner would take off to home.

- These situations allow fielders to make a decision about who to try and get out, and this is dependant on hit ball path and score. Fielder decisions - Double Play Ball? Go to First? Do I look the runner back then throw to first?

- These are pretty standard decsion making trees in baseball.
- The outfielders would be backing up bases incase the throw is off or the player misses the ball.

...

Q1: Players have a PI, Play Intellgence. this should be used to calculate decisions.
Q2, PI is part of a player skill set, it is not part of the box score. PI for now should influence defense and baserunning.
Q3. Keep player driven by now. Manager is down the road.
Q4. Cutoffs should be visuallized yes.

- Note 1st baseman typcially are in the infield and line themselves with the correct base to throw to. 1stbase men are used becuase relays are typically used when runners are going to 3rd or Home and no one is needed to cover 1st base; you use the 1st baseman. The pitcher backs up either home or 3rd depending on the throw from the outfield, they may actually wait between third and home until they know where the throw is going. A long single with the hitter/runner trying to get to second base - no runners on - to right field the 2nd baseman goes out, left field and center the short stop.

Q5: Infield Fly Rule: Must be less than two outs. runners at first and second, or first second and third, batter is automatically out. Ball must be fair. Runners cannot advance until the ball hits a fielder or ground - this applys to all fly balls. likely Runners would only advance on a bad error ie fielder drops the ball and the ball rolls away.

This prevents a dirty play where a fielder intentionally drops the ball to get easy double or triple play.

The parameters the ball needs to be a pop up, which is a judgement call. Lets start with 50 degrees LA and within +10 feet into the outfield where the infield and outfield meet.

...

Spray-aware r1→3rd difficulty — singles to RF make 3rd much easier than singles to LF
Tag-up PI — currently sacFlyTagProb is a flat constant; should be PI+speed gated
Steal attempts / pickoffs — the engine has none today; would need a new sub-module
Box-score / sim-lab UI surface — verify that the new behaviors look correct on the field render

The ball visually did not go over the fence. could be pixel processing . I noticed this before. >> Contact: 105 mph, LA 24°, spray -41° (LF-line), 364 ft, apex 62 ft — HR! <

On another home run the batter/runner still does not touch all the bases correctly.

Balls are still not rolling to a stop.

Also the ball should bounce off the wall or players. Eventually we will add more dynamic stadiums and the ball will need to bounce off other objects. The wall if its 10 feet should stop a ball at 9 feet the ball should bounce.

...
**_ Outfielder Play _**

- Lets start with outfielder play first, it is the simpliest.
- One given is all players know the number of outs, runs, and where the runners are on base, including the batter runner << This is called the game situation. the game situation informs players decisions where they move to, what base they cover, where and when to throw the ball. I may have written this out in another doc.
- All three outfielders should be 75 feet from the wall.
- Outfielders always throw ahead of the runner ie; if there is no one on base they would always throw second base. hits to left field the short stop covers second. Throws to right field the 2nd baseman covers second. For Centerfield if depends on the batter, a right handed batter the second baseman covers second, a left handed batter the short stop covers second.
- the center fielder takes priority when tracking a ball. he helps both the left and right fielder as a back up, and should converge on hits or outs to the outfield no matter the field.

**_ Outfielder to Infield _**

- Improve outfielder decisions.
- With Runners on base. When a hit is made to the outfield (not and out) their priority is to throw the ball ahead of the runner ie; runner at 2nd, that runner will try to get to 3rd. The throw should be to 3rd base, or home hitting the cutoff man between the bases. If the runner gets to 3rd or will the throw goes to the home (infield). A hit to left field the runner at 2nd may hold since the throw to third would be easier than say right field.
- right now we need to corridiate outfield defensive logic and positioning of cutoff men and throw priority. (runner logic will come later).

...

**_ Task _**

- game_engine_redesign
- Lets move forward with your hybrid approach.
- Notes:
  a) keep the sim we have worked do not change it, call this new one
  /sim-lab-2.
  b) I like the current layout and view and UI.
  c) Reuse the baseball field and layout, remember we will add stadium graphics and they need to be interchangeable. and we will add sprites for the players.
  c) Keep the player spites as they currently work where we can see the direction they are facing. Later we will add animation spites.

....

**\*_ Task _**

- Review the Sim-Lab-2 project in the baseballczar web app. We have run into some issue and hoping to get a fresh set of eyes.
- This app contains the sim logic - non graphic sim, the Playback of those games for the user to watch. Sim_Status.md has the run down of the app.
- earlier we did a refactor to improve architecture.
- Issues we are working on: play back sometimes does not show player either fielders or batter/runners. This is a persistant problem.
- Play by play needs a more specific readout for the user and Devs so we can know what is supposed to be happening v the renderer
- Time line Play/pause works but does not resume properly with the play by play continuing and the render not able to catch up.
- Sometime when the Sim Game starts the browser will not reload.
- Once these issues are fixed then we can work on game play, these are priorities.

**_ Game play Issues _**

- [ ] Batter readouts need to be added to play by play currently only
      Fouled off (2-2) — 68 mph, LA 23°, 172 ft LF-line << when a player puts the ball in play needs to be added >>

  > > on the pitch
  > > Lets work on a few visual items and fix these: - all player sprites have triangular hats on, this points to the front (player face) of the sprite.

- Runners need to face the home plate then turn to run to the next base.
- Fielders (and the pitcher) need to face home plate. They should turn to run to the ball, and turn to throw the ball to the target (player or base). This is a soft rule, but they cannot be turned away from the ball and catch it, field or throw the ball anywhere. AG determines this rotation speed. all players need some game awareness.
- Batter should face the pitcher (can you give them a bat an animate it? ).
- Fielders can run backwards but they have a 50% speed penalty. I believe this was handled in zones in the last sim.
- Questions just ask.

- Base runners need a lead off, and 1b must be inside the bag.

- Some of the throws aren't being shown.
- players need clear responsibility knowledge ie; game situation.

> Situation > the ball is hit to the oufield between two outfielders. Player safely reaches first but is called out with a lineout. it was not caught.
> in-play (0-0)
> → S. Foster: Lineout — off S. Young (2B)

- zoom in then clicking on ball after a play locked the sim viewer.

...

**_ Issue _**

- The website in dev mode is very slow to load and navigate. Can you evaluate the root cause. I know we are running webpack and probably other items that are pulling resources.

...
**_ Task _**

- Integrate sim-lab-2 into this UI /dashboard/games/
- remove old sim UI and replace with our updated module.

**_ Task. _**

- on the sim-lab-2 integration /dashboard/games/1xxxx we found some issues with scores. in this image the recorded score for the league is 8-0 but the sim shows 4-0. The first three games all had reported scores different than the sim-lab-2 score.

**_ Task _**

- Modify /dashboard/schedule - Change "Schedule" to "League" on the header button, update the content to show the entire league Schedule with 10 Game Pagnation.
- Add Filtering of Schedule By Team
- Add League Number to top right of schedule header > [League Schedule] [leagueNumber]
- On the Score Row Order Content left to right
  [Game Number][Game Date] [Away Team] @ [Home Team] [if played:"score", if not played:"--"][Button:Box][Button:Replay]
- Button:Box takes user to Box Score.
- Button:Sim takes user to Sim for Replay(Sim-Lab-2)

**_ Task _**

- Sim-Lab-2 needs a couple modes, maybe this means separate UI depending on use. But lets work through Sim-Lab-2's purpose:
- 1. This shows replays of simulated games in Baseballzar Web App. It is the Replay module for the Team Owner. When game is scheduled, any game in any league, and simulated the results should create a) player, team, league stats b) a box score of the game c) a Game Event Object containing ticks that are Rendered in Sim-Lab-2 so the game can be watched. This is the primary purpose of Sim-Lab-2. the work we have been doing was to develop the sim strategy off line using seeded games.
- 2. Replaying games or matchups to create a result with the ab
