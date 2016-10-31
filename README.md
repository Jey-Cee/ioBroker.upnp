![Logo](admin/upnp-discovery.png)
# ioBroker.upnp
=================

IMPORTANT: This Adapter is pre-Alpha state. 

Currently only the XML data of the upnp devices to be read and generates 
the objects for it.
This release is for demonstration of the object structure.


## Changelog
### 0.2.2
* (jey-cee) added listener for Alive/Dead messages from devices
* (jey-cee) if new devices joining the network they will added automatically
* (jey-cee) replace whitespace chars in device id's on creation, because objects and sub-object with whitespace chars wasn't usable


### 0.2.1
* (jey-cee) bug fixing: corrected creation of native's and smaller Bugs


#### 0.2.0
* (jey-cee) getting all xml data from upnp devices

#### 0.1.0
* (jey-cee) initial release

## License
The MIT License (MIT)

Copyright (c) 2016 Jey Cee <jey-cee@live.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
