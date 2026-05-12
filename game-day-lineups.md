# This is to clearify how the game day Lineup & Defense and Pitching Rotation works

- Player Skills:
These Skills should be loaded into the sim and saved as a players attributes.

## Table `players`

### Columns 
-The Sim should load the columns listed below, I know best practice is to load only data needed but for future development we will not need to rewrite data requests. 

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |. << Player ID Number never changes for the life of the player >>
| `team_id` | `int8` |  Nullable |. << Team ID Number>>> 
| `first_name` | `text` |  |
| `last_name` | `text` |  |
| `jersey_no` | `int4` |  |<< This is used to identify the player by number during the game >> This should also be limited to 1 - 99. 
| `position` | `text` |  | << defensive position the payer is assigned in the lineup >>
| `roster_status` | `text` |  | <<. Game Day Lineup or Not >>>
| `fielder` | `bool` |  |<< They are Not a Pitcher or Are a Pitcher >> 
| `batt_order` | `int4` |  Nullable | << If in lineup this is the batting order >>
| `rotation_slot` | `int4` |  Nullable | << If in rotation this is the rotation slot >>
| `age` | `int4` |  | 18 - 45 Limit. 
| `salary` | `int4` |  |
| `contract` | `int4` |  |
| `height` | `int4` |  Nullable |
| `weight` | `int4` |  Nullable |
| `hand_throw` | `int4` |  Nullable | << Must be L or R>>
| `hand_batting` | `int4` |  Nullable | << Must be L,R, S>>
| `speed` | `float4` |  | <<< All skills are 0 - 10 >>>
| `stamina` | `float4` |  |
| `ag` | `float4` |  |
| `eye` | `float4` |  |
| `avg` | `float4` |  |
| `strength` | `float4` |  |
| `dhr` | `float4` |  |
| `play_intel` | `float4` |  |
| `bunting` | `float4` |  |
| `fielding` | `float4` |  |
| `throw` | `float4` |  |
| `karma` | `float4` |  |
| `country_id` | `int4` |  |

